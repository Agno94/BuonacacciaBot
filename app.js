const TelegramBot = require('node-telegram-bot-api');
const express = require('express')
const bodyParser = require('body-parser');
const path = require('path')
const cron = require('node-cron');
const axios = require('axios')

// ENVIROMENT

const PORT = process.env.PORT || 5000;
const TG_TOKEN = process.env.TELEGRAM_API_TOKEN;
const TG_PATH = "tg" + TG_TOKEN.substring(12, 20);
const DATABASE_URL = process.env.DATABASE_URL;
const APP_URL = process.env.APP_URL || "";
const MAX_FIND_RESULTS = process.env.MAX_FIND_RESULTS || 8;

const app = express();
var BOT_USERNAME_REGEXP = "";
var server = null;

// SETTING

const { REGIONI, ZONES, CATEGORIES, BRANCHE } = require("./data.js");

const TEMPLATES = require("./templates.js")

// UTILS

function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function today() { return new Date(new Date().toDateString()); }

// DATABASE 

const Sequelize = require('sequelize');
const Op = Sequelize.Op;

const sequelize = new Sequelize(DATABASE_URL, { define: { timestamps: false } });
const { BCEvent, BCLog, Watcher, EventReply, ChatSession } = sequelize.import("./db.js");

// WEB-SCAPER / BC's EVENTS COLLECTION
const EventScraper = require('./scraper.js')
Scraper = new EventScraper(BCEvent, Sequelize);

// SESSION
const SessionManager = require('./session.js')
Session = new SessionManager(ChatSession);

function runWithSession(F) {// wrapped
  return async function (msg, ...Args) {
    let session = await Session.get(msg.chat.id);
    if (session) {
      msg.session = session;
      msg.processed = true;
      await F(msg, ...Args);
      msg.session.update({ status: msg.session.status });
    }
  }
}

// TO DO: add date of collection or reference to events 

// Watcher Send Message

async function watcherControll(events_list) {
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
  }
  //await wait(200);
  console.log("Sent messages for all watchers");
}

function catchAndLogError(e) {
  console.log("Error", e);
}

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

setTimeout(() => {
  //console.log("not running collection");
  Scraper.collect('', '').then(watcherControll).catch(catchAndLogError);
}, 3000);

// BOT SETUP

console.log("NODE_ENV='", process.env.NODE_ENV, "'");
if (process.env.NODE_ENV === 'production') {
  bot = new TelegramBot(TG_TOKEN);
  bot.setWebHook(APP_URL + TG_PATH);
} else {
  bot = new TelegramBot(TG_TOKEN, { polling: true });
}
bot.getMe().then((r) => {
  console.log("My username is ", r.username);
  BOT_USERNAME_REGEXP = RegExp("@" + r.username, "g");
  bot.on("message", (msg) => {
    msg.text = msg.text.replace(BOT_USERNAME_REGEXP, "");
    msg.chat.name = msg.chat.title || msg.chat.firstname;
  });
  console.log("Start listening");
  server = app.listen(PORT);
});

function sendError(msg) {
  return bot.sendMessage(msg.chat.id, `❌️ An error occurred`);
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
  let p = bot.sendMessage(msg.chat.id, TEMPLATES.BetaAlert, TEMPLATES.objBetaAlert)
  let list = await BCEvent.count({ where: { category: 'eg1' }, attributes: ["regione"], group: ['regione'] });
  await p;
  if (list.length) {
    let cat = status.regioneUsedWith[0];
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
    status.isSendingEventList = true;
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
    } finally {}
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
  bot.stopPolling();
  bot.closeWebHook();
  server.close();
  wait(1000).then(
    async () => { await Scraper.finish(); }
  ).then(
    async () => { await Session.saveAll(); }
  ).then(
    () => { console.log("Sessions saved"); },
    (e) => { console.log("Error", e); }
  ).then(() => {
    console.log("Quit!");
    process.exit();
  });
  return 1;
}

process.on("SIGINT", signalHandler);
process.on("SIGTERM", signalHandler);

// CRON SETUP

cron.schedule('0 10 6,9,12,18,21 * * 1-6', () => {
  console.log("Running scheduled collection ...");
  delay = Math.floor(Math.random() * 6 * 1000 + 1) * 100
  setTimeout(() => {
    Scraper.collect('', '').then(watcherControll).catch(catchAndLogError);
  }, delay);
  setTimeout(() => {
    Scraper.collect('eg5', '').then(watcherControll).catch(catchAndLogError);
  }, delay + 120 * 1000);
  setTimeout(() => {
    Scraper.collect('eg2', '').then(watcherControll).catch(catchAndLogError);
  }, delay + 180 * 1000);
  setTimeout(() => {
    Scraper.collect('', 'V').then(watcherControll).catch(catchAndLogError);
  }, delay + 240 * 1000);
}, {
  timezone: "Europe/Rome"
});

if ((process.env.NODE_ENV === 'production') && (APP_URL)) {
  cron.schedule('0 */20 * * * *', () => {
    axios.get(APP_URL).then(response => {
      console.log("Keep up: OK");
    }, error => {
      console.log("Keep up: Error:", error);
    });
  }, {
    timezone: "Europe/Rome"
  });
}

cron.schedule('0 0 1 * * *', async () => {
  console.log("chat reset");
  Session.counterReset();
}, {
  timezone: "Europe/Rome"
});

// ESPRESS SETUP

app.use(bodyParser.json());

app.set('views', path.join(__dirname, 'ejs'))
  .set('view engine', 'ejs')
  .get('/',
    (req, res) => res.render('simple'))
  .post('/' + TG_PATH, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });
