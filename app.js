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
  process.env.SCRAP_FORCE_TIME || (IS_PRODUCTION && 6 * 3600) || 30;

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
      console.log(`Received ${msg.text} by ${(msg.chat && msg.chat.id) || '?'}`);
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

// WATCHER EVENT NOTIFICATION

async function watchEvent() {
  console.log("Looking for unwatched events");
  let foundNotificationMessages = {};
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
      raw: true,
    });
    events = await eventsQuery;
    watchers = await watchersQuery;
    let notificationRefs = watchers.map(
      (w) => w.chatId
    ).filter(
      (id) => (!foundNotificationMessages[id])
    ).map(
      (chatID) => reply.message(MESSAGES.ONFOUND, { id: chatID }, {})
    );
    for (const ref of notificationRefs) {
      let r = await reply.response(ref);
      if (r.chat) foundNotificationMessages[r.chat.id] = r.message_id;
    }
    for (const event of events) {
      let refs = watchers.map(
        (w) => reply.message(MESSAGES.EVENT, { id: w.chatId }, {
          event: event.dataValues,
          reply_to: foundNotificationMessages[w.chatId],
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

// START, ABOUT, AND STATUS COMMAND

bot.onText(/\/start/, (msg, match) => {
  console.log("\/started by", msg.chat.id);
  reply.message(MESSAGES.WELCOME, msg.chat, {});
});

bot.onText(/\/about/, (msg, match) => {
  console.log("\/about to", msg.chat.id);
  reply.message(MESSAGES.ABOUT, msg.chat, {});
});

bot.onText(/\/status/, (msg, match) => {
  console.log("\/about to", msg.chat.id);
  Scraper.get_last_collection(true, true, true).then((collections) => {
    reply.message(MESSAGES.STATUS, msg.chat, collections);
  })
});

// SEARCH AND WATCH FUNCTIONS

function parseSelection(branca, cat, zone, reg) {
  // Validate parameters and determine current selection's step
  if (!(BRANCHE[branca] && (BRANCHE[branca].code == branca))) branca = false;
  if (!(CATEGORIES[cat] && (CATEGORIES[cat].code == cat))) cat = false;
  if ((!branca) && cat) branca = CATEGORIES[cat].branca;
  if (branca && !(cat) && (BRANCHE[branca].CATEGORIES.length == 1)) {
    cat = BRANCHE[branca].CATEGORIES[0].code;
    branca = '';
  }
  if (!(ZONES[zone] && (ZONES[zone].code == zone))) zone = false;
  if (!(REGIONI[reg] && (REGIONI[reg].code == reg)))
    reg = REGIONI.COMMAND2CODE[reg] || false;
  if ((!zone) && reg) zone = REGIONI[reg].zone;
  if (zone && !(reg) && (ZONES[zone].REGIONI.length == 1)) {
    reg = ZONES[zone].REGIONI[0].code;
    zone = '';
  }
  let step = SELECTION.COMPLETE;
  if (!cat) {
    step = (branca) ? SELECTION.CATEGORY : SELECTION.BRANCA;
  } else {
    if (!reg) step = (zone) ? SELECTION.REGIONE : SELECTION.ZONE;
  }
  let response = { step: step, backstep: step - 2 };
  if (branca) response.branca = branca;
  if (cat) response.cat = cat;
  if (zone) response.zone = zone;
  if (reg) response.reg = reg;
  response.selectedParams = [branca, cat, zone, reg].slice(0, step - 1);
  console.log("Selected parameters", JSON.stringify(response));
  return response;
}

async function searchProcess(selectionObj) {
  if (selectionObj.step < SELECTION.ZONE)
    return [selectionObj, { status: 'select' }];
  if (selectionObj.step < SELECTION.COMPLETE) {
    // Add results grouped by regione
    let list = await BCEvent.count({
      where: { category: selectionObj.cat, startdate: { [Op.gte]: today() } },
      attributes: ["regione"],
      group: ['regione']
    });
    selectionObj.list = list;
    // Only display regioni with events
    if (list.length <= 8) {
      selectionObj.step = SELECTION.REGIONE;
      selectionObj.forcedKeyboard = list.map((row) => REGIONI[row.regione]);
    }
    return [selectionObj, { status: 'select' }];
  }
  // Search is complete
  let count = await BCEvent.count({
    where: {
      startdate: { [Op.gte]: today() },
      regione: selectionObj.reg,
      category: selectionObj.cat,
    }
  }).catch(e => {
    console.log("Search failed");
    console.log(e);
    return -1;
  });
  reply_data = {
    step: SELECTION.COMPLETE,
    status: "complete",
    cat: selectionObj.cat,
    reg: selectionObj.reg,
    count: count,
  };
  extra_data = {
    status: "complete",
    cat: selectionObj.cat,
    reg: selectionObj.reg,
  };
  return [reply_data, extra_data];
}

async function searchCallback(replyObj, action = "", ...params) {
  if (action == "select") {
    if (replyObj.data.status != "select") return [false, "Ricerca terminata"];
    let selectionObj = parseSelection(...params);
    let [reply_data, extra_data] = await searchProcess(selectionObj).catch(catchAndLogError);
    if (JSON.stringify(extra_data) != JSON.stringify(replyObj.data)) {
      replyObj.update({ data: extra_data }).catch(catchAndLogError)
    }
    reply.update(replyObj, reply_data);
    return [true, ''];
  }
  if (action == "show") {
    if (replyObj.data.status != "complete") return [false, "Ricerca non conclusa"];
    if (!(replyObj.data.reg && replyObj.data.cat)) return [false, "Missing data"];
    let chatID = replyObj.chatID;
    let searchResults = await BCEvent.findAndCountAll({
      where: {
        startdate: { [Op.gte]: today() },
        regione: replyObj.data.reg,
        category: replyObj.data.cat,
      },
      raw: true,
    }).catch(e => { console.error("Error looking for results", e); return [] })
    let promises = searchResults.rows.map(
      (item) => {
        let ref = reply.message(MESSAGES.EVENT, { id: chatID }, { event: item });
        return reply.save(MESSAGES.EVENT, ref)
      });
    let extra_data = Object(replyObj.data);
    extra_data.status = "end";
    promises.push(replyObj.update({ data: extra_data }));
    promises = promises.map(
      (p) => (p.then((r) => true, (e) => {
        console.error("Error sending Search Results", response);
        return false
      }))
    );
    let reply_data = Object(extra_data);
    reply_data.step = SELECTION.COMPLETE;
    reply_data.count = searchResults.count;
    reply.update(replyObj, reply_data);
    if (!promises.every(async (p) => (await p))) {
      return [false, "Errore nell'invio dei messaggi"];
    }
    return [true, "Risultati inviati"]
  }
  if (action == "repeat") {
    if (replyObj.data.status != "end") return [false, "Ricerca non terminata"];
    let selectionObj = parseSelection('', replyObj.data.cat, '', replyObj.data.reg);
    let [reply_data, extra_data] = await searchProcess(selectionObj)
    replyObj.update({ data: extra_data }).catch(catchAndLogError)
    reply.update(replyObj, reply_data);
    return [true, ''];
  }
  if (action == "restart") {
    if (replyObj.data.status != "end") return [false, "Ricerca non terminata"];
    let [reply_data, extra_data] = await searchProcess(parseSelection())
    replyObj.update({ data: extra_data }).catch(catchAndLogError);
    reply.update(replyObj, reply_data);
    return [true, ''];
  }
  return [false, 'Invalid action'];
}

async function watcherProcess(selectionObj, chatID) {
  if (selectionObj.step < SELECTION.COMPLETE)
    return [selectionObj, false];
  let [ok, result] = await Watcher.findOrCreate({
    where: {
      chatId: chatID,
      category: selectionObj.cat,
      regione: selectionObj.reg,
    },
    default: { expiredate: new Date() }
  }).then(
    (r) => [true, r[0]],
    (e) => [false, e]
  );
  if (!ok) {
    console.error("On watcher findOrCreate", result);
    throw Error(result);
  };
  result.set('expiredate', new Date(today().getTime() + 2 * 365 * 24 * 3600 * 1000));
  selectionObj.status = "active";
  return [selectionObj, result];
}

async function watchCallback(replyObj, action = "", ...params) {
  if (action == "select") {
    if (replyObj.data.status != 'select') return [false, "Osservatore completo"];
    let selectionObj = parseSelection(...params);
    let [reply_data, watcher] = await watcherProcess(selectionObj, replyObj.chatID);
    if (watcher) {
      replyObj.update({ data: { status: 'active', id: watcher.id } });
      watcher.msgId = replyObj.msgID;
      await watcher.save()
    }
    reply.update(replyObj, reply_data);
    if (!watcher) return [true, 'Scegli e clicca'];
    return [true, 'Creato']
  }
  if (action == "new") {
    let ref = reply.message(MESSAGES.WATCH, { id: replyObj.chatID }, { step: SELECTION.BRANCA });
    await reply.save(MESSAGES.WATCH, ref, { status: 'select' });
    return [true, ''];
  }
  if (action == 'cancel') {
    if (replyObj.data.status != 'active') return [false, "Non c'è niente di attivo"];
    let watcher = await Watcher.findByPk(replyObj.data.id).catch((e) => false);
    if (!watcher) return [false, "Nessun osservatore attivo associato"];
    let reply_data = {
      step: SELECTION.COMPLETE,
      cat: watcher.category,
      reg: watcher.regione,
      status: "cancelled",
    }
    await watcher.destroy().catch(e => e).then(r => console.log(r));
    replyObj.update({ data: { status: 'cancelled' } });
    reply.update(replyObj, reply_data);
    return [false, "Non implementato"];
  }
}

// BOT: SET UP SEARCH AND WATCH FUNCTION

bot.onText(/\/cerca[ _]*$/, Session.runWith((msg, match) => {
  let ref = reply.message(MESSAGES.SEARCH, msg.chat, { step: SELECTION.BRANCA, });
  reply.save(MESSAGES.SEARCH, ref, { status: 'select' });
}));

bot.onText(/\/cerca[ _]+([a-zA-Z0-9]*)[ _]*(.*)/, Session.runWith((msg, match) => {
  let c = match[1].toLowerCase();
  let r = match[2].trim().replace(/[_ 'x]/g, "").toLowerCase();
  let selectionObj = parseSelection('', c, '', r);
  searchProcess(selectionObj).then(([reply_data, status]) => {
    let ref = reply.message(MESSAGES.SEARCH, msg.chat, reply_data);
    reply.save(MESSAGES.SEARCH, ref, status);
  }).catch(catchAndLogError);
}));

bot.onText(/\/osserva[ _]*$/, Session.runWith((msg, match) => {
  let ref = reply.message(MESSAGES.WATCH, msg.chat, { step: SELECTION.BRANCA, });
  reply.save(MESSAGES.WATCH, ref, { status: 'select' });
}));

bot.onText(/\/osserva[ _]+([a-zA-Z0-9]+)[ _]*(.*)/, Session.runWith(async (msg, match) => {
  let c = match[1].toLowerCase();
  let r = match[2].trim().replace(/[_ 'x]/g, "").toLowerCase();
  let selectionObj = parseSelection('', c, '', r);
  watcherProcess(selectionObj, msg.chat.id).then(async ([reply_data, watcher]) => {
    let extra_data = { status: 'select' };
    let ref = reply.message(MESSAGES.WATCH, msg.chat, reply_data);
    if (watcher) {
      response = await reply.response(ref);
      watcher.msgId = response.message_id;
      extra_data = { status: 'active', id: watcher.id };
      await watcher.save();
    }
    reply.save(MESSAGES.WATCH, ref, extra_data);
  }).catch(catchAndLogError);
}));

function oldWarning(msg, match) {
  bot.sendMessage(msg.chat.id, "❌️ SONO CAMBIATO: usa /cerca o /osserva");
}

bot.onText(/\/nazionale[ _]*/, oldWarning);

bot.onText(/\/regione.*/, oldWarning);

bot.onText(/\/tutti[ _]*$/, oldWarning);

bot.onText(/\/mostra[ _]*([0-9]*)/, oldWarning);


// EVENT AND ALARM

async function eventCallback(replyObj, action = "", ...params) {
  return [false, "Funzione non ancora disponibile"];
}

// CANCEL ACTIVE WATCHER OR ALARM

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
  cancelFindList(msg.chat.id).then(async (data) => {
    let ref = reply.message(MESSAGES.CANCEL, msg.chat, data);
    let replyMsg = await reply.response(ref);
    if (replyMsg.ok) {
      Reply.create({
        type: sequelize.CANCEL_REPLY,
        chatID: msg.chat.id,
        msgID: replyMsg.message_id,
      });
    } else throw Error(result);
  }, (e) => {
    console.error("Error on \/annulla", e);
    sendError();
  })
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

// CALLBACK QUERY HANDLER

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
  let callback_params = data.split("/").map(l => l.trim());//.filter(l => l);
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
  let callbackHandler = null;
  switch (type) {
    case (MESSAGES.CANCEL):
      callbackHandler = cancelCallback;
      break;
    case (MESSAGES.WATCH):
      callbackHandler = watchCallback;
      break;
    case (MESSAGES.SEARCH):
      callbackHandler = searchCallback;
      break;
    case (MESSAGES.EVENT):
      callbackHandler = eventCallback;
      break;
    default:
      bot.answerCallbackQuery(query.id, { text: "Non implementato", });
  }
  if (callbackHandler) {
    [status, text] = await callbackHandler(replyObj, ...callback_params.slice(1));
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
  wait(25000).then(() => {
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
