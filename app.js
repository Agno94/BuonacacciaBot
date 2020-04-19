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
const { TEMPLATES } = require("./templates.js")
const { MESSAGES, SELECTION } = require("./message.js");

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
const { BCEvent, BCLog, Watcher, Reply, Alarm, ChatSession } = sequelize.import("./db.js");

// WEB-SCAPER / BC's EVENTS COLLECTION
const EventScraper = require('./scraper.js');
Scraper = new EventScraper(BCEvent, BCLog, Sequelize);

// SESSION
const SessionManager = require('./session.js');
Session = new SessionManager(ChatSession);

// CHECK DATABASE AND INIZIALIZE OBJECT

let startJobDB = sequelize.authenticate().then(() => {
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

const Replier = require("./reply.js")
const reply = new Replier(bot, Reply);

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

let startJobBot = bot.getMe().then((r) => {
  console.log("My username is ", r.username);
  BOT_USERNAME_REGEXP = RegExp("@" + r.username, "g");
  bot.on("message", (msg) => {
    if (msg.text) {
      msg.text = msg.text.replace(BOT_USERNAME_REGEXP, "");
    }
    msg.chat.name = msg.chat.title || msg.chat.firstname;
  });
  console.log("Start listening");
  server = app.listen(PORT);
}).catch((e) => {
  console.error("Unable to get information about myself. Exiting");
  console.log(e);
  process.exit(1);
})

// Watcher Send Message

async function watchEvent() {
  console.log("Looking for unwatched events");
  let list = await BCEvent.count({
    where: {
      hasBeenWatched: false,
      // [Op.and]: [Sequelize.literal(
      //   'EXISTS (SELECT * FROM watchers WHERE watchers.category::text = bc_event.category::text)'
      // )]
    },
    attributes: ["category", "regione"],
    group: ['category', 'regione']
  });
  for (const params of list) {
    let eventsQuery = BCEvent.findAll({
      where: {
        hasBeenWatched: false,
        category: params.category,
        regione: params.regione,
      }
    });
    let watchersQuery = Watcher.findAll({
      where: {
        category: params.category,
        regione: params.regione,
      },
    });
    events = await eventsQuery;
    watchers = await watchersQuery;
    for (const event of events) {
      let refs = watchers.map(
        (w) => reply.message(MESSAGES.EVENT, { id: w.chatId }, {
          event: event.dataValues,
          reply_to: w.msgId,
        })
      )
      await wait(100);
      for (const ref of refs) await reply.response(ref);
      BCEvent.update({
        hasBeenWatched: true,
      }, {
        where: { bcId: event.bcId }
      }).catch(catchAndLogError);
    }
  }
}

// Bot

bot.onText(/\/start/, Session.runWith(
  (msg, match) => {
    const chatId = msg.chat.id;
    console.log("\/start received by", chatId);
    reply.message(MESSAGES.WELCOME, msg.chat, {});
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
    let reply_data = {
      step: SELECTION.COMPLETE,
      cat: categoryID,
      reg: regioneID,
      emoji: BRANCHE[CATEGORIES[categoryID].branca].emoji,
      count: r.count,
    }
    if (r.count > MAX_FIND_RESULTS) {
      let status = msg.session.status;
      status.hasEventList = true;
      status.eventList = r.rows.map((e) => e.dataValues);
      msg.session.save({ fields: ['status'] }).catch(
        (e) => console.log("error updating session", e)
      )
      reply_data.many = true;
      reply.message(MESSAGES.SEARCH, { id: chatId }, reply_data);
    } else {
      if (r.count) {
        let msgRefs = r.rows.map(
          (item) => reply.message(MESSAGES.EVENT, { id: chatId }, {
            event: item.dataValues,
          })
        );
        for (const ref of msgRefs) {
          let response = await reply.response(ref);
          if (response.error) console.log("Error sending Search Results", response);
        }
      }
      reply.message(MESSAGES.SEARCH, { id: chatId }, reply_data);
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
    let ref = reply.message(MESSAGES.WATCH, msg.chat, {
      step: SELECTION.COMPLETE,
      cat: cat,
      reg: reg,
      emoji: BRANCHE[CATEGORIES[cat].branca].emoji,
      id: wid,
    });
    let resp = await reply.response(ref);
    watcher.msgId = resp.message_id;
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
    if (!r) {
      let status = msg.session.status;
      status.askedForRegione = true;
      status.regioneUsedFor = F;
      type = { 'search': MESSAGES.SEARCH, 'watch': MESSAGES.WATCH }[F];
      status.regioneUsedWith = [cat];
      BCEvent.count({
        where: { category: cat },
        attributes: ["regione"],
        group: ['regione']
      }).then((list) => {
        let reply_data = {
          step: SELECTION.REGIONE,
          emoji: BRANCHE[CATEGORIES[cat].branca].emoji,
          cat: cat,
          list: list,
        };
        let ref = reply.message(type, msg.chat, reply_data)
      })
    }
    return [cat, r];
  } else {
    return [false, false];
  }
}

function selectRegione(msg, regione_cmd) {
  console.log(regione_cmd);
  let status = msg.session.status;
  if (!status.askedForRegione) {
    bot.sendMessage(msg.chat.id, "help TO DO");
    return;
  }
  let regione = REGIONI.COMMAND2CODE[regione_cmd];
  let command = status.regioneUsedFor;
  let args = status.regioneUsedWith;
  if (!regione) {
    let cat = args[0];
    BCEvent.count({
      where: { category: cat },
      attributes: ["regione"],
      group: ['regione']
    }).then((list) => {
      let reply_data = {
        step: SELECTION.REGIONE,
        emoji: BRANCHE[CATEGORIES[cat].branca].emoji,
        cat: cat,
        list: list,
      };
      type = { 'search': MESSAGES.SEARCH, 'watch': MESSAGES.WATCH }[command];
      let ref = reply.message(type, msg.chat, reply_data)
    })
    return;
  }
  // let command = status.regioneUsedFor;
  // let args = status.regioneUsedWith;
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


bot.onText(/\/cerca[ _]*$/, Session.runWith((msg, match) => {
  console.log("onText \/cerca")
  const chatId = msg.chat.id;
  reply.message(MESSAGES.SEARCH, msg.chat, { step: SELECTION.CATEGORY, });
}));

bot.onText(/\/cerca[ _]+([a-z0-9]+)[ _]*(.*)/, Session.runWith((msg, match) => {
  console.log("onText \/cerca_CAT", match);
  let [category, regione] = paramsAndRun("search", msg, match[1].toLowerCase(), match[2]);
  if (!category) {
    reply.message(MESSAGES.SEARCH, msg.chat, { step: SELECTION.CATEGORY, });
    return;
  }
  if (!regione) return;
  const chatId = msg.chat.id;
  search(msg, chatId, category, regione);
}));

bot.onText(/\/osserva[ _]*$/, Session.runWith((msg, match) => {
  console.log("on Text \/osserva");
  reply.message(MESSAGES.WATCH, msg.chat, { step: SELECTION.CATEGORY, });
}));

bot.onText(/\/osserva[ _]+([a-z0-9]+)[ _]*(.*)/, Session.runWith((msg, match) => {
  console.log("onText \/osserva_..._...", match);
  let [category, regione] = paramsAndRun("watch", msg, match[1], match[2]);
  if (!category) {
    reply.message(MESSAGES.WATCH, msg.chat, { step: SELECTION.CATEGORY, });
    return;
  }
  if (!regione) return;
  const chatId = msg.chat.id;
  watch(msg, chatId, category, regione);
}));

bot.onText(/\/nazionale[ _]*/, Session.runWith((msg, match) => {
  selectRegione(msg, "nazionale");
}));

bot.onText(/\/regione[ _]*([A-Za-z _]*)/, Session.runWith((msg, match) => {
  selectRegione(msg, match[1].replace(/[_ ]/g, "").toLowerCase());
}));

bot.onText(/\/tutti[ _]*$/, Session.runWith(async (msg, match) => {
  let status = msg.session.status;
  if (!status.askedForRegione) {
    bot.sendMessage(msg.chat.id, "help TO DO");
    return;
  }
  let cat = status.regioneUsedWith[0];
  let list = await BCEvent.count({ where: { category: cat }, attributes: ["regione"], group: ['regione'] });
  let reply_data = {
    step: SELECTION.REGIONE,
    emoji: BRANCHE[CATEGORIES[cat].branca].emoji,
    cat: cat,
    list: list,
  };
  type = { 'search': MESSAGES.SEARCH, 'watch': MESSAGES.WATCH }[status.regioneUsedFor];
  let ref = reply.message(type, msg.chat, reply_data)
  await reply.response(ref);
  bot.sendMessage(msg.chat.id, "⚠️ La selezione di più regioni non è stata implementata 🚧");
}));

// Show search results
bot.onText(/\/mostra[ _]*([0-9]*)/, Session.runWith(async (msg, match) => {
  console.log("onText \/mostra", match[1]);
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
      let send_list = status.eventList.slice(0, no_events);
      status.eventList = status.eventList.slice(no_events);
      let msg_refs = send_list.map(
        (item) => reply.message(MESSAGES.EVENT, msg.chat, { event: item })
      );
      for (const ref of msg_refs) await reply.response(ref);
    } catch (e) {
      sendError(msg);
      console.log("Error showing results:", e);
    }
    status.hasEventList = Boolean(status.eventList.length);
    delete status.temp.isSendingEventList;
    if (status.hasEventList)
      reply.message(MESSAGES.SHOW, msg.chat, { count: status.eventList.length });
    else delete status.hasEventList;
  } else {
    bot.sendMessage(chatId, "Nessun messaggio da mostrare"); // TO DO: reply-to
  }
}));

async function cancelFindList(chatID, searchWatchers = true, searchAlarms = true) {
  let watchersQuery = [];
  let alarmEventsQuery = [];
  if (searchWatchers) {
    watchersQuery = Watcher.findAll({
      where: { chatId: chatID, expiredate: { [Op.gte]: new Date() } },
      attributes: ['category', 'regione'],
    }).then((r) => r.map(
      (w) => `Tipo ${CATEGORIES.EMOJI(w.category)}${CATEGORIES[w.category].human} regione ${REGIONI[w.regione].human}`
    ));
  }
  if (searchAlarms) {
    alarmEventsQuery = BCEvent.findAll({
      include: [{
        model: Alarm,
        where: { warning: true },
        include: [{
          model: Reply,
          where: { chatID: chatID },
        }]
      }],
      attributes: ['category', 'regione', 'location'],
    }).then((r) => r.map(
      (e) => `${CATEGORIES.EMOJI(e.category)}${CATEGORIES[e.category].human} presso ${e.location}(${REGIONI[e.regione].human})`
    ));
  }
  let data = {
    watchers: await watchersQuery,
    alarmEvents: await alarmEventsQuery,
  };
  // data.watchers = await watchersQuery;
  // data.alarmEvents = await alarmEventsQuery;
  return data;
}

async function cancelHandler(msg, match) {
  console.log("annulla called");
  try {
    let wid = Number(match[1]);
    console.log("wid", wid)
    if (wid) {
      let single = Watcher.findByPk(wid).then(
        async (r) => {
          console.log("r", r);
          await r.destroy();
          bot.sendMessage(msg.chat.id, "Eliminato", {});
          return true;
        }).catch((e) => { console.log(e); return false });
      console.log("single", single);
      if (single) return;
    }
  } catch (e) {
    console.log("Error on \/anulla, old part", e);
  }
  cancelFindList(msg.chat.id).then(data => {
    reply.message(MESSAGES.CANCEL, msg.chat, data);
  }, (e) => {
    console.error("Error on \/annulla", e);
    sendError();
  });
}

async function cancelCallback(replyObj, action = "", target = "") {
  update = async () => await cancelFindList(replyObj.chatID).then(
    data => { reply.update(replyObj, data); },
    (e) => {
      console.error("Error on \/annulla", e);
      sendError();
    });
  try {
    switch (action) {
      case ("del"):
        if (target == "watch") {
          await Watcher.destroy({
            where: { chatId: replyObj.chatID },
          }).catch(catchAndLogError);
          // TO DO: change watchers replies text
          await update().catch(catchAndLogError);
          return [true, "Osservatori Eliminati"];
        } else if (target == "alarm") {
          // await Alarm.update(
          // { warning: false },
          // { include: [{ model: Reply, where: { chatID: chatID }, }] }
          // );
          await sequelize.query(
            `UPDATE alarms SET warning = false FROM alarms a INNER JOIN replies r ON a."replyId" = r."id" AND r."chat_id" = :chatID`,
            { replacements: { chatID: replyObj.chatID }, type: sequelize.QueryTypes.UPDATE },
          );
          // TO DO: change watchers replies text
          await update().catch(catchAndLogError);
          return [true, "Promemoria disattivati"];
        }
        break;
      case ("show"):
        return [false, "Non ancora implemantato"];
        break;
      case ("update"):
        update();
        return [true, ""];
    }
  } catch (e) {
    console.error(e);
    return [false, "A bot error"];
  }
  return [false, "Invalid parameters"];
}

bot.onText(/\/annulla[ _]*([0-9]*)/, Session.runWith(cancelHandler));

bot.onText(/\/promemoria[ _]*$/, Session.runWith((msg, match) => {
  bot.sendMessage(msg.chat.id, TEMPLATES.BetaAlert + "\nNon ancora implementato", { parse_mode: 'HTML' });
}))

bot.on('callback_query', async (query) => {
  const { message: { chat, message_id } = {}, data } = query;
  function exitWithAlert(e) {
    console.error(`Callback error: message ${message_id} chat ${chat.id}: ${e}`);
    console.error("  data: ", query.data);
    bot.answerCallbackQuery(query.id, {
      text: `Error: ${e}`,
      show_alert: false,
    });
  };
  Session.callback(chat.id);
  let callback_params = data.split("/").map(l => l.trim()).filter(l => l);
  let type = callback_params[0];
  if (!MESSAGES.callBackSet.has(type)) return exitWithAlert("Invalid query");
  let messages = await Reply.findAndCountAll({
    where: {
      chatID: chat.id,
      msgID: message_id,
    },
  });
  if (messages.count != 1) return exitWithAlert(`${messages.count} replies`);
  let replyObj = messages.rows[0];
  if (type != replyObj.type) return exitWithAlert(`Mismatching types`);
  let status, text;
  switch (type) {
    case (MESSAGES.CANCEL):
      [status, text] = await cancelCallback(replyObj, ...callback_params.slice(1));
      break;
    default:
      bot.answerCallbackQuery(query.id, { text: "Non implementato", });
  }
  if (!status) return exitWithAlert(text);
  if (text) bot.answerCallbackQuery(query.id, { text: text });
});

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
      while (reply.isActive()) {
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

if (process.env.APP_SCHEDULE_COLLECTION) {
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
};

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

startJobDB.then(() => {
  cron.schedule('0 0 1 * * *', async () => {
    console.log("chat reset");
    Session.counterReset();
  });
});

startJobBot.then(async () => {
  await startJobDB;
}).then(
  watchEvent
).then(async () => {
  // If no collection has been performed in the last SCRAP_FORCE_TIME seconds
  //  then one is ran now
  let collections = await Scraper.get_last_collection(true, true, false);
  if (
    (!collections.successful) ||
    ((new Date() - collections.last.date) > SCRAP_FORCE_TIME * 1000) ||
    ((new Date() - collections.successful.date) > 2000 * SCRAP_FORCE_TIME)
  ) {
    r = await Scraper.collect('', '').catch(catchAndLogError);
    if (r.length) {
      axios.get(APP_URL).catch(
        error => { console.log("Keep up: Error:", error); }
      );
      watchEvent().catch(catchAndLogError);
    }
  } else {
    console.log(`A collection has been run ${(new Date() - collections.last.date) / 1000}s ago`);
  }
})
