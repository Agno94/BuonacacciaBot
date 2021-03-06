const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const cron = require('node-cron');
const axios = require('axios');

// ENVIROMENT & SETTING

const PORT = process.env.PORT || 5000;
const TELEGRAM_API_TOKEN = process.env.TELEGRAM_API_TOKEN;
const TG_PATH = "/tg" + TELEGRAM_API_TOKEN.replace(/[^0-9a-z]+/g, "");
const DATABASE_URL = process.env.DATABASE_URL;
const APP_URL = process.env.APP_URL || "";

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

function today() { return new Date(new Date().toISOString().slice(0, 10)); };

function catchAndLogError(e) {
  console.error("Error", e.message, e);
};

function sendError(msg) {
  return bot.sendMessage(msg.chat.id, `❌️ An error occurred`);
};

function italianTime(date) {
  return new Date(date.toLocaleString("en-US", { timeZone: "Europe/Rome" }))
}

// DATABASE AND WEB-SCAPPER

const Sequelize = require('sequelize');
const sequelize = new Sequelize(DATABASE_URL, { define: { timestamps: false } });
const db = sequelize.import("./db.js");

const EventScraper = require('./scraper.js');
Scraper = new EventScraper(db);

let startJobDB = sequelize.authenticate().then(async () => {
  return await sequelize.sync({ logging: false });
}).catch(err => {
  console.error("Database error:", err);
  process.exit(1);
}).then(() => {
  console.log("Database OK");
}).then(() => {
  Scraper.initialize();
});

// BOT & EXPRESS SETUP

const SessionManager = require('./session.js');
Session = new SessionManager(db);

if (IS_PRODUCTION) {
  bot = new TelegramBot(TELEGRAM_API_TOKEN);
  bot.setWebHook(APP_URL + TG_PATH);
} else {
  bot = new TelegramBot(TELEGRAM_API_TOKEN, { polling: true });
};

const Replier = require("./reply.js")
const replier = new Replier(bot, db, Session);

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

Session.onTooMany((delta, chat) => {
  if (!(delta % 5) && (delta <= 20)) {
    bot.sendMessage(chat.id, "Sto ricevendo centinaia di messaggi da questa chat, lasciami ripostare un'oretta", {});
  }
}, (delta, chat, queryID) => {
  if (!(delta % 4) && (delta <= 32)) {
    bot.answerCallbackQuery(queryID, {
      text: "Sto ricevendo centinaia di richieste da questa chat, lasciami ripostare un'oretta"
    });
  }
  if (delta == 32) bot.sendMessage(chat.id, "Sto ricevendo molte richieste da questa chat, lasciami ripostare un'oretta", {});
})

let startJobBot = bot.getMe().then((r) => {
  console.log("My username is ", r.username);
  BOT_USERNAME_REGEXP = RegExp("@" + r.username, "g");
  bot.on("message", (msg) => {
    try {
      if (msg.text) {
        let session = Session.message(msg.chat);
        if (!session) {
          msg.text = '';
          return;
        }
        msg.session = session;
        msg.text = msg.text.replace(BOT_USERNAME_REGEXP, "");
        if (!IS_PRODUCTION || process.env.DEBUG)
          console.log(`Received ${msg.text} by ${msg.chat.id}`);
      }
    } catch (e) { console.error(e); }
  });
}).then(() => {
  console.log("Start listening");
  server = app.listen(PORT);
}).catch((e) => {
  console.error("Unable to get information about myself. Exiting");
  console.log(e);
  process.exit(1);
})

// PERIODIC JOB

async function checkRunCollection() {
  // If no collection has been performed in the last SCRAP_FORCE_TIME seconds
  //  then one is ran now
  await Scraper.finish();
  let collections = await Scraper.getLastCollection(true, true, false);
  if (
    (!collections.successful) ||
    ((new Date() - collections.last.date) > SCRAP_FORCE_TIME * 1000) ||
    ((new Date() - collections.successful.date) > 2000 * SCRAP_FORCE_TIME)
  ) {
    await Scraper.collect('', '').catch(catchAndLogError);
    for (const p of COLLECTIONS.SPECIALS) await Scraper.collect(p.c, p.r);
  } else {
    console.log(`A collection has been run ${(new Date() - collections.last.date) / 1000}s ago, skipping`);
  }
}

// Run checkRunCollection at startup
let collectionJob = startJobBot.then(async () => {
  await startJobDB;
}).then(checkRunCollection)

async function sendEventList(events = [], chats = [], option = (c) => { }) {
  let promises = [];
  for (const event of events)
    for (const chatID of chats)
      promises.push({
        ref: db.Alarm.count({
          where: { warning: true, eventId: event.id },
          include: [{ model: db.Reply, where: { chatID: chatID }, attributes: [] }],
          raw: true
        }).then(
          (hasAlarm) => replier.message(
            MESSAGES.EVENT,
            { id: chatID },
            Object.assign({
              event: event.dataValues || event,
              hasAlarm: Boolean(hasAlarm),
            }, option(chatID))
          )
        ),
        reply: db.Reply.findOne({
          where: {
            type: MESSAGES.EVENT,
            data: { id: event.id },
            chatID: chatID
          }
        }).catch(console.error),
        eventID: event.id,
      });
  promises = promises.map(
    (job) => job.ref.then(async (ref) => {
      let reply = await job.reply
      if (!reply) await replier.save(MESSAGES.EVENT, ref, { id: job.eventID });
      else await replier.add(reply, ref);
    }).then((r) => true, (e) => {
      console.error("Error sending events' list", e.response || e);
      return false
    })
  );
  for (const p of promises) if (!(await p)) throw false;
  // if (!promises.every(async (p) => (await p))) throw false;
  return true;
}

async function watchEvent() {
  console.log("Looking for unwatched events");
  let foundNotificationMessages = {};
  let list = await db.BCEvent.count({
    where: {
      hasBeenWatched: false,
      // [db.Op.and]: [Sequelize.literal(
      //   'EXISTS (SELECT * FROM watchers WHERE watchers.category::text = bc_event.category::text)'
      // )]
    },
    attributes: ["category", "regione"],
    group: ['category', 'regione']
  });
  for (const params of list) {
    let eventsQuery = db.BCEvent.findAll({
      where: {
        hasBeenWatched: false,
        category: params.category,
        regione: params.regione,
      }
    });
    let watchersQuery = db.Watcher.findAll({
      where: {
        category: params.category,
        regione: params.regione,
      },
      raw: true,
    });
    events = await eventsQuery;
    watchers = await watchersQuery;
    let notificationRefs = watchers.map(
      (w) => w.chatID
    ).filter(
      (id) => (!foundNotificationMessages[id])
    ).map(
      (chatID) => replier.message(MESSAGES.ONFOUND, { id: chatID }, {})
    );
    for (const ref of notificationRefs) {
      let r = await replier.response(ref);
      if (r.chat) foundNotificationMessages[r.chat.id] = r.message_id;
    }
    for (const event of events) {
      let job = sendEventList(
        [event],
        watchers.map(w => w.chatID),
        (chatID) => Object({ reply_to: foundNotificationMessages[chatID] }),
      );
      await wait(100);
      if (!(await job)) console.error(`Error sending event for ${params}`);
      event.update({ hasBeenWatched: true, }).catch(catchAndLogError);
    }
  }
}

// Run watchEvent at startup
collectionJob.then(watchEvent).catch(catchAndLogError);

const MORNING_ALARM_TIME = 8;
const EVENING_ALARM_TIME = 17;
function isAlarmHour(hour) {
  return (hour == MORNING_ALARM_TIME) || (hour == EVENING_ALARM_TIME);
}

async function alarmSend(hour) {
  console.log("Checking for alarm and sending notification ... ");
  async function sendNotification(type, list) {
    let refs = list.map((alarm) => {
      let chat = Session.chatInfo(alarm.reply.chatID) || { id: alarm.reply.chatID };
      let data = {
        event: alarm.bc_event.dataValues,
        day: (hour == MORNING_ALARM_TIME) ? 'oggi' : 'domani',
        reply_to_list: alarm.reply.messages.map(m => m.tgID),
      }
      return replier.message(type, chat, data);
    })
    for (const ref of refs) await replier.response(ref);
  }
  async function findActiveAlarm(condition) {
    return await db.Alarm.findAll({
      where: { warning: true, },
      include: [{
        model: db.BCEvent,
        where: condition,
      }, {
        model: db.Reply,
        include: [db.TGMessage]
      },],
    }).catch(catchAndLogError);
  }
  if (hour == MORNING_ALARM_TIME) {
    let alarms = await findActiveAlarm({ subscriptiondate: today() })
    await sendNotification(MESSAGES.MEMO_SUB, alarms).catch(catchAndLogError);
  }
  if (hour == EVENING_ALARM_TIME) {
    let tomorrow = new Date(today().getTime() + 24 * 3600 * 1000);
    let subscrAlarms = await findActiveAlarm({ subscriptiondate: tomorrow });
    let subscrJob = sendNotification(MESSAGES.MEMO_SUB, subscrAlarms).catch(catchAndLogError);
    let startAlarms = await findActiveAlarm({ startdate: tomorrow });
    await subscrJob;
    let startJob = sendNotification(MESSAGES.MEMO_START, startAlarms).catch(catchAndLogError);
    let endAlarms = await findActiveAlarm({
      enddate: tomorrow,
      startdate: { [db.Op.lt]: today() },
    });
    await startJob
    await sendNotification(MESSAGES.MEMO_END, endAlarms).catch(catchAndLogError);
  }
}

// Job to be run every hour
cron.schedule('0 10 * * * *', async () => {
  await collectionJob;
  let italianHour = italianTime(new Date()).getHours();
  if (isAlarmHour(italianHour)) await alarmSend(italianHour).catch(catchAndLogError);
  else console.log("not checking alarm");
  if (!COLLECTIONS.EXEC_TIME.has(italianHour)) await checkRunCollection();
  await watchEvent().catch(catchAndLogError);
});

// Keep application running on Heroku
if (IS_PRODUCTION && APP_URL) {
  cron.schedule('0 */20 * * * *', () => {
    let italianHour = italianTime(new Date()).getHours();
    if (process.env.KEEP_UP || replier.isActive() || isAlarmHour(italianHour)) {
      console.log(`Keep running: Request ${APP_URL} to avoid being put to sleep`);
      axios.get(APP_URL).catch(
        error => { console.error("Keep running: Error:", error); }
      );
    }
  });
}

// BOT: START, ABOUT, AND STATUS COMMAND

bot.onText(/\/start/, (msg, match) => {
  replier.message(MESSAGES.WELCOME, msg.chat, {});
});

bot.onText(/\/about/, (msg, match) => {
  replier.message(MESSAGES.ABOUT, msg.chat, {});
});

bot.onText(/\/status/, (msg, match) => {
  Scraper.getLastCollection(true, true, true).then((results) => {
    let L = [results.last, results.successful, results.unempty];
    let optionsDate = { year: 'numeric', month: 'long', day: 'numeric' };
    let optionsTime = { hour: 'numeric', minute: 'numeric' };
    let R = L.map((item) => Object({
      status: item.status,
      date: italianTime(item.date).toLocaleDateString('it-IT', optionsDate),
      time: italianTime(item.date).toLocaleTimeString('it-IT', optionsTime),
    }))
    return { last: R[0], successful: R[1], unempty: R[2] }
  }).then((collections) => {
    replier.message(MESSAGES.STATUS, msg.chat, collections);
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
    let list = await db.BCEvent.count({
      where: { category: selectionObj.cat, startdate: { [db.Op.gte]: today() } },
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
  let count = await db.BCEvent.count({
    where: {
      startdate: { [db.Op.gte]: today() },
      regione: selectionObj.reg,
      category: selectionObj.cat,
    }
  }).catch(e => {
    console.log("Search failed");
    console.error(e);
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
    replier.update(replyObj, reply_data);
    return [true, ''];
  }
  if (action == "show") {
    if (replyObj.data.status != "complete") return [false, "Ricerca non conclusa"];
    if (!(replyObj.data.reg && replyObj.data.cat)) return [false, "Missing data"];
    let chatID = replyObj.chatID;
    let searchResults = await db.BCEvent.findAndCountAll({
      where: {
        startdate: { [db.Op.gte]: today() },
        regione: replyObj.data.reg,
        category: replyObj.data.cat,
      },
      raw: true,
    }).catch(e => { console.error("Error looking for results", e); return [] })
    let sendPromise = sendEventList(searchResults.rows, [chatID]);
    await wait(100);
    let extra_data = Object.assign({}, replyObj.data);
    extra_data.status = "end";
    let reply_data = Object.assign({}, extra_data);
    reply_data.step = SELECTION.COMPLETE;
    reply_data.count = searchResults.count;
    replyObj.update({ data: extra_data }).catch(console.error);
    replier.update(replyObj, reply_data);
    if (await sendPromise) return [true, "Risultati inviati"]
    else return [false, "Errore nell'invio dei messaggi"];
  }
  if (action == "repeat") {
    if (replyObj.data.status != "end") return [false, "Ricerca non terminata"];
    let selectionObj = parseSelection('', replyObj.data.cat, '', replyObj.data.reg);
    let [reply_data, extra_data] = await searchProcess(selectionObj)
    replyObj.update({ data: extra_data }).catch(catchAndLogError)
    replier.update(replyObj, reply_data);
    return [true, ''];
  }
  if (action == "restart") {
    if (replyObj.data.status != "end") return [false, "Ricerca non terminata"];
    let [reply_data, extra_data] = await searchProcess(parseSelection())
    replyObj.update({ data: extra_data }).catch(catchAndLogError);
    replier.update(replyObj, reply_data);
    return [true, ''];
  }
  return [false, 'Invalid action'];
}

async function watcherProcess(selectionObj, chatID) {
  if (selectionObj.step < SELECTION.COMPLETE)
    return [selectionObj, false];
  let [ok, result] = await db.Watcher.findOrCreate({
    where: {
      chatID: chatID,
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
  const activeData = { status: 'active' };
  let reply = await result.getReply().then(
    r => r || result.createReply({
      chatID: chatID,
      type: MESSAGES.WATCH,
      data: activeData,
    })
  ).catch((e) => {
    console.error("On watcher getReply", e);
    return false
  });
  if (!reply) throw Error(reply);
  result.set('expiredate', new Date(today().getTime() + 10 * 365 * 24 * 3600 * 1000));
  result.save();
  Object.assign(selectionObj, activeData);
  if (reply.data.status != 'active') {
    reply.update({ data: activeData });
    replier.update(reply, selectionObj);
  }
  let ref = replier.message(MESSAGES.WATCH, Session.chatInfo(chatID) || { id: chatID }, selectionObj);
  replier.add(reply, ref);
  return [false, result];
}

async function cancelWatcher(watcher, reply) {
  let reply_data = {
    step: SELECTION.COMPLETE,
    status: "cancelled",
  }
  await reply.update({ data: { status: 'cancelled' } });
  replier.update(reply, reply_data);
}

async function watchCallback(replyObj, action = "", ...params) {
  if (action == "select") {
    if (replyObj.data.status != 'select') return [false, "Osservatore completo"];
    let selectionObj = parseSelection(...params);
    replier.update(replyObj, selectionObj);
    if (selectionObj.step == SELECTION.COMPLETE) {
      replyObj.update({ data: { status: 'select', params: params } });
      return [true, 'Pronto per essere attivato']
    } else return [true, 'Scegli e clicca']

  }
  if (action == 'create') {
    if (replyObj.data.status != 'select') return [false, "Osservatore completo"];
    let selectionObj = parseSelection(...replyObj.data.params);
    let [reply_data, watcher] = await watcherProcess(selectionObj, replyObj.chatID);
    if (!watcher) return [false, 'Osservatore NON creato'];
    return [true, 'Creato']
  }
  if (action == "new") {
    let ref = replier.message(MESSAGES.WATCH, { id: replyObj.chatID }, { step: SELECTION.BRANCA });
    await replier.save(MESSAGES.WATCH, ref, { status: 'select' });
    return [true, ''];
  }
  if (action == 'cancel') {
    if (replyObj.data.status != 'active') return [false, "Non c'è niente di attivo"];
    let watcher = await db.Watcher.findAndCountAll({
      where: { reply_id: replyObj.id }
    }).then(
      ({ rows, count }) => ((count == 1) && (rows[0]))
    ).catch((e) => false);
    if (!watcher) return [false, "Nessun osservatore attivo associato"];
    cancelWatcher(watcher, replyObj);
    await watcher.destroy().then(console.log, console.error);
    replier.update(replyObj, reply_data);
    return [true, 'Eliminato'];
  }
  return [false, 'Azione non prevista']
}

// BOT: SET UP SEARCH AND WATCH FUNCTION

bot.onText(/\/cerca[ _]*$/, (msg, match) => {
  let ref = replier.message(MESSAGES.SEARCH, msg.chat, { step: SELECTION.BRANCA, });
  replier.save(MESSAGES.SEARCH, ref, { status: 'select' });
});

bot.onText(/\/cerca[ _]+([a-zA-Z0-9]*)[ _]*(.*)/, (msg, match) => {
  let c = match[1].toLowerCase();
  let r = match[2].trim().replace(/[_ 'x]/g, "").toLowerCase();
  let selectionObj = parseSelection('', c, '', r);
  searchProcess(selectionObj).then(([reply_data, status]) => {
    let ref = replier.message(MESSAGES.SEARCH, msg.chat, reply_data);
    replier.save(MESSAGES.SEARCH, ref, status);
  }).catch(catchAndLogError);
});

bot.onText(/\/osserva[ _]*$/, (msg, match) => {
  let ref = replier.message(MESSAGES.WATCH, msg.chat, { step: SELECTION.BRANCA, });
  replier.save(MESSAGES.WATCH, ref, { status: 'select' });
});

bot.onText(/\/osserva[ _]+([a-zA-Z0-9]+)[ _]*(.*)/, async (msg, match) => {
  let c = match[1].toLowerCase();
  let r = match[2].trim().replace(/[_ 'x]/g, "").toLowerCase();
  let selectionObj = parseSelection('', c, '', r);
  watcherProcess(selectionObj, msg.chat.id).then(async ([reply_data, watcher]) => {
    if (!watcher) {
      let extra_data = { status: 'select' };
      let ref = replier.message(MESSAGES.WATCH, msg.chat, reply_data);
      await replier.save(MESSAGES.WATCH, ref, extra_data);
    }
  }).catch(catchAndLogError);
});

function oldWarning(msg, match) {
  bot.sendMessage(msg.chat.id, "❌️ SONO CAMBIATO: usa /cerca o /osserva");
}

bot.onText(/\/nazionale[ _]*/, oldWarning);

bot.onText(/\/regione.*/, oldWarning);

bot.onText(/\/tutti[ _]*$/, oldWarning);

bot.onText(/\/mostra[ _]*([0-9]*)/, oldWarning);


// EVENT AND ALARM

async function eventCallback(replyObj, action = "", ...params) {
  if (action == 'alarm') {
    let event = await db.BCEvent.findOne({ where: { bc: params[0] } });
    if (!event) return [false, 'Trovato nessun evento richiesto'];
    let alarms = await replyObj.getAlarms();
    if (alarms.length > 2) return [false, 'Numero di promemoria errato'];
    let alarm;
    if (!alarms.length) {
      alarm = db.Alarm.build({
        warning: true,
        replyId: replyObj.id,
        eventId: event.id,
      });
    } else {
      alarm = alarms[0];
      if (alarm.eventId != event.id) return [false, 'Evento diverso dal messaggio'];
      alarm.set('warning', !alarm.warning);
    }
    let r = await alarm.save().then(() => true, catchAndLogError)
    replier.update(replyObj, { event: event, hasAlarm: alarm.warning });
    let response = alarm.warning ? 'Promemoria attivi' : 'Promemoria disattivi';
    if (r) return [true, response]
    else return [true, 'Unknown']
  }
  return [false, "Azione non prevista"];
}

// CANCEL ACTIVE WATCHER OR ALARM

async function cancelFindList(chatID, searchWatchers = true, searchAlarms = true) {
  let watchersQuery = [];
  let alarmEventsQuery = [];
  if (searchWatchers) {
    watchersQuery = db.Watcher.findAll({
      where: { chatID: chatID, expiredate: { [db.Op.gte]: new Date() } },
      attributes: ['category', 'regione'],
    }).then((r) => r.map(
      (w) => `Tipo ${CATEGORIES.EMOJI(w.category)}${CATEGORIES[w.category].human} regione ${REGIONI[w.regione].human}`
    ));
  }
  if (searchAlarms) {
    alarmEventsQuery = db.BCEvent.findAll({
      include: [{
        model: db.Alarm,
        where: { warning: true },
        include: [{
          model: db.Reply,
          where: { chatID: chatID },
        }]
      }],
      where: { enddate: { [db.Op.gte]: today() } },
      attributes: ['category', 'regione', 'location'],
    }).then((r) => r.map(
      (e) => `${CATEGORIES.EMOJI(e.category)}${CATEGORIES[e.category].human} presso ${e.location}(${REGIONI[e.regione].human})`
    ));
  }
  let data = {
    watchers: await watchersQuery,
    alarmEvents: await alarmEventsQuery,
  };
  return data;
}

async function cancelHandler(msg, match) {
  cancelFindList(msg.chat.id).then(async (data) => {
    let ref = replier.message(MESSAGES.CANCEL, msg.chat, data);
    await replier.save(MESSAGES.CANCEL, ref);
  }, (e) => {
    console.error("Error on \/annulla", e);
    sendError();
  })
}

async function cancelCallback(replyObj, action = "", target = "") {
  update = async () => await cancelFindList(replyObj.chatID).then(
    data => { replier.update(replyObj, data); },
    (e) => {
      console.error("Error on \/annulla", e);
      sendError();
    });
  try {
    switch (action) {
      case ("del"):
        if (target == "watch") {
          let replyList = await db.Reply.findAll({
            where: { type: MESSAGES.WATCH },
            include: [{
              model: db.Watcher,
              where: { chatID: replyObj.chatID }
            }]
          });
          await db.Watcher.destroy({
            where: { chatID: replyObj.chatID },
          }).catch(catchAndLogError);
          replyList.map(
            reply => cancelWatcher(reply.watcher, reply)
          );
          await update().catch(catchAndLogError);
          return [true, "Osservatori Eliminati"];
        } else if (target == "alarm") {
          // await Alarm.update(
          // { warning: false },
          // { include: [{ model: db.Reply, where: { chatID: chatID }, }] }
          // );
          let replyList = await db.Reply.findAll({
            where: {
              type: MESSAGES.EVENT,
              chatID: replyObj.chatID,
            }, include: [{
              model: db.Alarm,
              where: { warning: true },
              attributes: []
            }]
          })
          await sequelize.query(
            `UPDATE alarms SET warning = false FROM alarms a INNER JOIN replies r ON a."replyId" = r."id" AND r."chat_id" = :chatID`,
            { replacements: { chatID: replyObj.chatID }, type: sequelize.QueryTypes.UPDATE },
          );
          replyList.map(async (reply) => {
            let event = await db.BCEvent.findByPk(reply.data.id);
            replier.update(reply, { event: event, hasAlarm: false });
          });
          await update().catch(catchAndLogError);
          return [true, "Promemoria disattivati"];
        }
        break;
      case ("show"):
        let chatInfo = Session.chatInfo(replyObj.chatID) || { id: replyObj.chatID };
        if (target == 'watch') {
          let watchers = await db.Watcher.findAll({
            where: { chatID: replyObj.chatID },
            include: [db.Reply]
          }).catch(console.error);
          if (!watchers) return [false, 'A database error'];
          let promises = watchers.map((w) => {
            let ref = replier.message(
              MESSAGES.WATCH,
              chatInfo, {
              step: SELECTION.COMPLETE,
              status: (w.expiredate > new Date()) ? 'active' : 'expired',
              cat: w.category,
              reg: w.regione,
            });
            return replier.add(w.reply, ref);
          });
          for (const p of promises) await p;
          return [true, 'Messaggi inviati'];
        } else if (target == 'alarm') {
          let alarms = await db.Alarm.findAll({
            where: { warning: true },
            include: [
              { model: db.BCEvent, where: { enddate: { [db.Op.gte]: today() } } },
              { model: db.Reply, where: { chatID: replyObj.chatID } },
            ],
          }).catch(console.error);;
          if (!alarms) return [false, 'A database error'];
          let promises = alarms.map((a) => {
            let ref = replier.message(MESSAGES.EVENT, chatInfo, {
              event: a.bc_event.dataValues,
              hasAlarm: true,
            });
            return replier.add(a.reply, ref);
          });
          for (const p of promises) await p;
          return [true, 'Messaggi inviati'];
        }
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

bot.onText(/\/annulla[ _]*([0-9]*)/, (cancelHandler));

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
  if (!Session.callback(chat, query.id)) return;
  let callback_params = data.split("/").map(l => l.trim());//.filter(l => l);
  let type = callback_params[0];
  if (!MESSAGES.callBackSet.has(type)) return exitWithAlert("Invalid query");
  let replies = await db.Reply.findAndCountAll({
    where: { chatID: chat.id },
    include: [{
      model: db.TGMessage,
      where: { tgID: message_id },
      attributes: ['tgID'],
    }]
  });
  if (replies.count != 1) return exitWithAlert(`${replies.count} replies`);
  let replyObj = replies.rows[0];
  replyObj.msgID = message_id;
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

var isSignalAlreadyReceived = false;

function signalHandler(SIGNAL) {
  console.log("Received", SIGNAL);
  if (isSignalAlreadyReceived) {
    setTimeout(() => { process.exit(0); }, 1000);
    return;
  }
  Scraper.pause();
  server.close();
  bot.stopPolling();
  bot.closeWebHook();
  Scraper.finish().then(
    () => { console.log("Sessions saved"); },
    (e) => { console.error("Error", e); }
  ).then(
    async () => {
      while (replier.isActive()) {
        console.log("Waiting for messages to be sent");
        await wait(1000);
      };
    }
  ).then(() => {
    console.log("Quit!");
    process.exit();
  });
  setTimeout(() => { process.exit(0); }, 29900);
  isSignalAlreadyReceived = true;
  return 1;
}

process.on("SIGINT", signalHandler);
process.on("SIGTERM", signalHandler);
