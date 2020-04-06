const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const cron = require('node-cron');
const axios = require('axios');

// ENVIROMENT & SETTING

const PORT = process.env.PORT || 5000;
const TG_TOKEN = process.env.TELEGRAM_API_TOKEN;
const TG_PATH = "/tg" + TG_TOKEN.substring(12, 20);
const DATABASE_URL = process.env.DATABASE_URL;
const APP_URL = process.env.APP_URL || "";

const MAX_FIND_RESULTS = process.env.MAX_FIND_RESULTS || 8;
const IS_PRODUCTION = (process.env.NODE_ENV === 'production');
const SCRAP_FORCE_TIME =
  process.env.SCRAP_FORCE_TIME || (IS_PRODUCTION && 12 * 3600) || 10;

const { REGIONI, ZONES, CATEGORIES, BRANCHE, COLLECTIONS } = require("./data.js");

const TEMPLATES = require("./templates.js")

// UTILS

function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
};

function today() { return new Date(new Date().toDateString()); };

function catchAndLogError(e) {
  console.error("Error", e.message, e);
};

function sendError(msg) {
  return bot.sendMessage(msg.chat.id, `❌️ An error occurred`);
};

// DATABASE 

const Sequelize = require('sequelize');
const Op = Sequelize.Op;

const sequelize = new Sequelize(DATABASE_URL, { define: { timestamps: false } });
const { BCEvent, BCLog, Watcher, EventReply, ChatSession } = sequelize.import("./db.js");

// WEB-SCAPER / BC's EVENTS COLLECTION
const EventScraper = require('./scraper.js');
Scraper = new EventScraper(BCEvent, BCLog, Sequelize);

// SESSION
const SessionManager = require('./session.js');
Session = new SessionManager(ChatSession);

function runWithSession(F) {
  // Run every fuction adding a session property to the incoming message
  return async function (msg, ...Args) {
    let session = await Session.get(msg.chat.id);
    if (session) {
      msg.session = session;
      msg.processed = true;
      await F(msg, ...Args);
      msg.session.update({ status: msg.session.status });
    };
  };
};

// CHECK DATABASE AND INIZIALIZE OBJECT

sequelize.authenticate().then(() => {
  return sequelize.sync({ logging: false });
}).catch(err => {
  console.log("Database error:", err);
  process.exit(1);
}).then(() => {
  console.log("Database OK");
}).then(() => {
  Scraper.initialize();
  Session.initialize();
});

// BOT & EXPRESS SETUP

if (IS_PRODUCTION) {
  bot = new TelegramBot(TG_TOKEN);
  bot.setWebHook(APP_URL + TG_PATH);
} else {
  bot = new TelegramBot(TG_TOKEN, { polling: true });
};

const app = express();
var server = null;

app.use(bodyParser.json());

app.set('views', path.join(__dirname, 'ejs'))
  .set('view engine', 'ejs')
  .get('/',
    (req, res) => res.render('simple'))
  .post(TG_PATH, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });

var BOT_USERNAME_REGEXP = "";

bot.getMe().then((r) => {
  console.log("My username is ", r.username);
  BOT_USERNAME_REGEXP = RegExp("@" + r.username, "g");
  bot.on("message", (msg) => {
    msg.text = msg.text.replace(BOT_USERNAME_REGEXP, "");
    msg.chat.name = msg.chat.title || msg.chat.firstname;
  });
  console.log("Start listening");
  server = app.listen(PORT);
}).catch((e) => {
  console.error("Unable to get information about myself. Exiting");
  console.log(e);
  process.exit(1);
})

// MIGHT BE TO DO: add relation (one2many?) between events and collection log

// Watcher Send Message

async function watcherCheck() {
  let events_list = await BCEvent.findAll({
    where: { hasBeenWatched: false },
  }).catch((e) => {
    console.error("Selection of unwatched events failed", e.message);
    return [];
  });
  console.log(`Found ${events_list.length} events`);
  return events_list
}

var is_processing_watcher = false;

async function watcherSend(events_list) {
  is_processing_watcher = true;
  let cache = {};
  for (const event of events_list) {
    let r = event.regione;
    let c = event.category;
    let watchers;
    if (cache[c] && cache[c][r]) {
      watchers = cache[c][r];
    } else {
      watchers = await Watcher.findAll({
        where: {
          regione: r,
          category: c,
        },
        attributes: ['chatId', 'msgId'],
      }).then((x) => {
        if (!cache[c]) cache[c] = {};
        cache[c][r] = x;
        return x;
      }).catch((e) => {
        console.error("Error", e);
        console.error("event was", event);
        return [];
      })
    }
    pool = watchers.map(
      (w, i) => wait(i * 100).then(
        bot.sendMessage(w.chatId, TEMPLATES.event2HTML(event), {
          parse_mode: 'HTML',
          reply_to_message_id: w.msgId,
        })).then(
          () => console.log("message sent")
        )
    );
    await wait(1000);
    for (const msg in pool) await msg;
    BCEvent.update({
      hasBeenWatched: true,
    }, {
      where: { bcId: event.bcId }
    }).catch(catchAndLogError);
  }
  //await wait(200);
  is_processing_watcher = false;
  console.log("Sent messages for all watchers");
}

bot.onText(/\/start/, runWithSession(
  (msg, match) => {
    const chatId = msg.chat.id;
    console.log("\/start received by", chatId);
    bot.sendMessage(chatId, TEMPLATES.Welcome(), TEMPLATES.objWelcome);
  }));

function search(msg, chatId, categoryID, regioneID) {
  console.log("cerca", chatId, categoryID, regioneID);
  BCEvent.findAndCountAll({
    where: {
      startdate: { [Op.gte]: today() },
      regione: regioneID,
      category: categoryID,
    }
  }).then(async (r) => {
    bot.sendChatAction(chatId, "typing");
    bot.sendMessage(chatId, TEMPLATES.BetaAlert, TEMPLATES.objBetaAlert);
    if (r.count > MAX_FIND_RESULTS) {
      let status = msg.session.status;
      status.hasEventList = true;
      status.eventList = r.rows.map((e) => e.dataValues);
      msg.session.save({ fields: ['status'] }).catch(
        (e) => console.log("error updating session", e)
      )
      await bot.sendMessage(chatId, TEMPLATES.SearchManyResults(r.count), TEMPLATES.objSearchManyResults);
      //console.log(msg.session, Session.get(chatId));
      bot.sendMessage(chatId, TEMPLATES.SearchEnd(categoryID, regioneID), TEMPLATES.objSearchEnd);
    } else if (r.count) {
      let msgs = r.rows.map((item) => {
        reply = TEMPLATES.event2HTML(item);
        return bot.sendMessage(chatId, reply, TEMPLATES.objEventReply);
      })
      for (const msg of msgs) {
        await msg;
      }
      bot.sendMessage(chatId, TEMPLATES.SearchEnd(categoryID, regioneID), TEMPLATES.objSearchEnd);
    } else {
      bot.sendMessage(chatId, TEMPLATES.NoSearchResult(categoryID, regioneID), TEMPLATES.objNoSearchResult);
    }
  }).catch(e => {
    console.log("Search failed");
    console.log(e);
  });
}

function watch(msg, chat_id, cat, reg) {
  console.log("osserva", msg.chat, cat, reg);
  Watcher.findOrCreate({
    where: {
      chatId: chat_id,
      category: cat,
      regione: reg,
    },
    default: { expiredate: new Date() }
  }).then(async (r) => {
    let watcher = r[0];
    let wid = watcher.id;
    watcher.expiredate = new Date(today().getTime() + 2 * 365 * 24 * 3600 * 1000);
    r = await bot.sendMessage(chat_id,
      TEMPLATES.WatcherCreation(cat, reg, wid), TEMPLATES.objWatcherCreation);
    watcher.msgId = r.message_id;
    await watcher.save();
  }, (e) => {
    sendError(msg);
    console.log("Error in watch on findOrCreate", e);
  }).catch((e) => {
    sendError(msg);
    console.log("Error in watch", e);
  }).finally(
    () => console.log("watcher added")
  );
}

function paramsAndRun(F, msg, cat, reg) {
  if (CATEGORIES.SET.has(cat)) {
    let h = reg.trim().replace(/[_ 'x]/g, "").toLowerCase();
    let r = REGIONI.COMMAND2CODE[h];
    console.log("regione = ", r)
    if (!r) {
      let status = msg.session.status;
      status.askedForRegione = true;
      status.regioneUsedFor = F;
      status.regioneUsedWith = [cat];
      bot.sendMessage(msg.chat.id, TEMPLATES.AskRegione, TEMPLATES.objAskRegione);
      return [cat, r]
    } else {
      return [cat, r];
    }
  } else {
    return [false, false];
  }
}

function selectRegione(msg, regione_cmd) {
  console.log(regione_cmd);
  //bot.sendMessage(msg.chat.id, "Non implementato");
  let status = msg.session.status;
  if (!status.askedForRegione) {
    bot.sendMessage(msg.chat.id, "help TO DO");
    return;
  }
  let regione = REGIONI.COMMAND2CODE[regione_cmd];
  console.log(regione);
  if (!regione) {
    //Wrong Regione
    bot.sendMessage(msg.chat.id, TEMPLATES.AskRegione, TEMPLATES.objAskRegione);
    return;
  }
  let command = status.regioneUsedFor;
  let args = status.regioneUsedWith;
  delete status.askedForRegione;
  delete status.regioneUsedFor;
  delete status.regioneUsedWith;
  if (command == "search") {
    // console.log("running", "search", msg, msg.chat.id, args[0], regione);
    search(msg, msg.chat.id, args[0], regione);
  } else if (command == "watch") {
    // console.log("running", "watch", msg, msg.chat.id, args[0], regione);
    watch(msg, msg.chat.id, args[0], regione)
  } else {
    console.error("Unhandled command", command);
  }
};


bot.onText(/\/cerca[ _]*$/, runWithSession((msg, match) => {
  console.log("onText \/cerca")
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, TEMPLATES.SearchHelp(msg.chat.name), TEMPLATES.objSearchHelp);
}));

bot.onText(/\/cerca[ _]+([a-z0-9]+)[ _]*(.*)/, runWithSession((msg, match) => {
  console.log("onText \/cerca_CAT", match);
  let [category, regione] = paramsAndRun("search", msg, match[1].toLowerCase(), match[2]);
  if (!category) {
    bot.sendMessage(chatId, TEMPLATES.SearchHelp(msg.chat.name), TEMPLATES.objSearchHelp);
    return;
  }
  if (!regione) return;
  const chatId = msg.chat.id;
  search(msg, chatId, category, regione);
}));

bot.onText(/\/osserva[ _]*$/, runWithSession((msg, match) => {
  console.log("on Text \/osserva");
  bot.sendMessage(msg.chat.id, TEMPLATES.WatchHelp(msg.chat.name), TEMPLATES.objWatchHelp);
}));

bot.onText(/\/osserva[ _]+([a-z0-9]+)[ _]*(.*)/, runWithSession((msg, match) => {
  console.log("onText \/osserva_..._...", match);
  let [category, regione] = paramsAndRun("watch", msg, match[1], match[2]);
  if (!category) {
    bot.sendMessage(chatId, TEMPLATES.WatchHelp(msg.chat.name), TEMPLATES.objWatchHelp);
    return;
  }
  if (!regione) return;
  const chatId = msg.chat.id;
  watch(msg, chatId, category, regione);
}));

bot.onText(/\/nazionale[ _]*/, runWithSession((msg, match) => {
  selectRegione(msg, "nazionale");
}));

bot.onText(/\/regione[ _]*([A-Za-z _]*)/, runWithSession((msg, match) => {
  selectRegione(msg, match[1].replace(/[_ ]/g, "").toLowerCase());
}));

bot.onText(/\/tutti[ _]*$/, runWithSession(async (msg, match) => {
  let status = msg.session.status;
  if (!status.askedForRegione) {
    bot.sendMessage(msg.chat.id, "help TO DO");
    return;
  }
  let p = bot.sendMessage(msg.chat.id, TEMPLATES.BetaAlert, TEMPLATES.objBetaAlert);
  let cat = status.regioneUsedWith[0];
  let list = await BCEvent.count({ where: { category: cat }, attributes: ["regione"], group: ['regione'] });
  await p;
  if (list.length) {
    let message_text = TEMPLATES.MultiSelectionWarning(
      status.regioneUsedFor, cat, list);
    await bot.sendMessage(msg.chat.id, TEMPLATES.AskRegione, TEMPLATES.objAskRegione);
    bot.sendMessage(msg.chat.id, message_text, TEMPLATES.objMultiSelectionWarning);
  } else {
    bot.sendMessage(msg.chat.id, "⚠️ La selezione di più regioni non è stata implementata 🚧");
    bot.sendMessage(msg.chat.id, "Nessun evento di questo tipo trovato");
  }
}));

// Show search results
bot.onText(/\/mostra[ _]*([0-9]*)/, runWithSession(async (msg, match) => {
  console.log("onText \/mostra", match);
  let no_events;
  try {
    no_events = Number(match[1] || "10000")
  } catch (e) {
    console.log("Error on \/mostra", e)
    return;
  }
  let chatId = msg.chat.id;
  let status = msg.session.status;
  while (status.temp.isSendingEventList) {
    await wait(200);
  }
  if (status.hasEventList) {
    let len = status.eventList.length;
    no_events = Math.min(no_events, len);
    status.temp.isSendingEventList = true;
    await bot.sendMessage(chatId,
      `Sto per inviare i dettagli di <b>${no_events}</b> eventi`, { parse_mode: 'HTML' })
    try {
      while (no_events) {
        await wait(500);
        let batch_len = Math.min(MAX_FIND_RESULTS, no_events);
        let send_list = status.eventList.slice(0, batch_len);
        let msgs = send_list.map((item) => {
          reply = TEMPLATES.event2HTML(item);
          return bot.sendMessage(chatId, reply, { parse_mode: 'HTML' });
        });
        status.eventList = status.eventList.slice(batch_len);
        no_events -= batch_len;
        delay = wait(1000);
        for (const msg of msgs) await msg;
        if (no_events) bot.sendChatAction(chatId, "typing");
        await delay;
      }
    } catch (e) {
      sendError(msg);
      console.log("Error showing results:", e);
    } finally { }
    status.hasEventList = Boolean(status.eventList.length);
    delete status.temp.isSendingEventList;
    if (status.hasEventList)
      bot.sendMessage(chatId,
        TEMPLATES.OtherResults(status.eventList.length), { parse_mode: 'HTML' });
    else delete status.hasEventList;
  } else {
    bot.sendMessage(chatId, "Nessun messaggio da mostrare"); // TO DO: reply-to
  }
}));

bot.onText(/\/annulla[ _]*([0-9])+/, runWithSession((msg, match) => {
  try {
    let wid = Number(match[1]);
    Watcher.destroy({
      where: { id: wid }
    }).then((r) => {
      console.log("del", r);
      bot.sendMessage(msg.chat.id, TEMPLATES.BetaAlert + "\nEliminato", { parse_mode: 'HTML' });
    });
  } catch (e) {
    sendError(msg);
    console.log("Errore", e);
  }
}));


bot.onText(/\/promemoria[ _]*$/, runWithSession((msg, match) => {
  bot.sendMessage(msg.chat.id, TEMPLATES.BetaAlert + "\nNon ancora implementato", { parse_mode: 'HTML' });
}))

// ON SIGINT OR SIGTERM

function signalHandler(SIGNAL) {
  console.log("Received", SIGNAL);
  Scraper.pause();
  server.close();
  bot.stopPolling();
  bot.closeWebHook();
  wait(1000).then(
    async () => { await Scraper.finish(); }
  ).then(
    async () => { await Session.saveAll(); }
  ).then(
    () => { console.log("Sessions saved"); },
    (e) => { console.error("Error", e); }
  ).then(
    async () => {
      while (is_processing_watcher) {
        console.log("Waiting for messages to be sent");
        await wait(1000);
      };
    }
  ).then(() => {
    console.log("Quit!");
    process.exit();
  });
  wait(20000).then(() => {
    process.exit(10);
  })
  return 1;
}

process.on("SIGINT", signalHandler);
process.on("SIGTERM", signalHandler);

// CRON SETUP

cron.schedule('0 10 * * * *', async () => {
  var italian_hour = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Rome" })).getHours();
  console.log(italian_hour);
  if (!COLLECTIONS.EXEC_TIME.has(italian_hour)) return;
  console.log("Running scheduled collection ...");
  await Scraper.collect('', '').then(watcherSend).catch(catchAndLogError);
  for (const p of COLLECTIONS.SPECIALS) {
    let job = Scraper.collect(p.c, p.r);
    job.then(watcherSend).catch(catchAndLogError);
    await job;
  }
});

if (IS_PRODUCTION && APP_URL) {
  cron.schedule('0 */20 * * * *', () => {
    if (process.env.KEEP_UP) {
      console.log(`Keep up: Request ${APP_URL} to avoid sleep`);
      axios.get(APP_URL).catch(
        error => { console.log("Keep up: Error:", error); }
      );
    }
  });
}

cron.schedule('0 0 1 * * *', async () => {
  console.log("chat reset");
  Session.counterReset();
}, {
  timezone: "Europe/Rome"
});

job = wait(1000).then(watcherCheck).then(watcherSend);

setTimeout(async () => {
  // If no collection has been performed in the last SCRAP_FORCE_TIME seconds
  //  then one is ran now
  collections = await Scraper.get_last_collection(true, true, false);
  await job;
  delta_last = (new Date() - collections.last.date) / 1000;
  delta_success = (new Date() - collections.successful.date) / 1000;
  if (
    (delta_last > SCRAP_FORCE_TIME) ||
    (delta_success > 2 * SCRAP_FORCE_TIME)
  ) {
    Scraper.collect('', '').then(watcherSend).catch(catchAndLogError);
  }
}, 1000);
