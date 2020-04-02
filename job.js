const { COLLECTIONS } = require("./data");

var italian_hour = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Rome" })).getHours();
if (!COLLECTIONS.EXEC_TIME.has(italian_hour)) {
    console.log("Running only on scheduled time! Exit");
    process.exit(0);
}

const axios = require('axios');

// ENVIROMENT & SETTING

const DATABASE_URL = process.env.DATABASE_URL;
const APP_URL = process.env.APP_URL || "";

// DATABASE

const Sequelize = require('sequelize');

const sequelize = new Sequelize(DATABASE_URL, { define: { timestamps: false } });
const { BCEvent, BCLog, Watcher, EventReply, ChatSession } = sequelize.import("./db.js");

const EventScraper = require('./scraper.js');
Scraper = new EventScraper(BCEvent, BCLog, Sequelize);

// SIGNAL HANDLER

function signalHandler(SIGNAL) {
    console.log("Received", SIGNAL);
    Scraper.pause();
    Scraper.finish().finally(() => {
        console.log("Exit!");
        process.exit();
    });
    setTimeout(() => process.exit(10), 20000);
    return 1;
}

process.on("SIGINT", signalHandler);
process.on("SIGTERM", signalHandler);

// JOB

let job = sequelize.authenticate().then(
    async () => {
        await sequelize.sync({ logging: false })
    }
).then(
    async () => {
        console.log("Database OK");
        await Scraper.initialize();
    }
).catch(
    err => {
        console.log("Database error:", err);
        process.exit(1);
    }
);

job = job.then(
    async () => await Scraper.collect('', '')
);

for (const p of COLLECTIONS.SPECIALS) {
    job = job.then(
        async (r) => {
            l = await Scraper.collect(p.c, p.r);
            return r.concat(l);
        }
    );
};

job.catch(
    (e) => {
        console.error("Error during collection", e);
        process.exit(1);
    }
).then(
    async (r) => {
        if ((r.length) && APP_URL) {
            return await axios.get(APP_URL).then(
                () => console.log("Wake up app to send watchers")
            )
        };
    }
).then(
    (r) => process.exit(0),
    (e) => {
        console.error("Http request error:", e);
        process.exit(2);
    }
);
