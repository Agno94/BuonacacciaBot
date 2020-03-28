const axios = require('axios');

// ENVIROMENT & SETTING

const DATABASE_URL = process.env.DATABASE_URL;
const APP_URL = process.env.APP_URL || "";

// DATABASE

const Sequelize = require('sequelize');

const sequelize = new Sequelize(DATABASE_URL, { define: { timestamps: false } });
const { BCEvent, BCLog, Watcher, EventReply, ChatSession } = sequelize.import("./db.js");

const EventScraper = require('./scraper.js');
Scraper = new EventScraper(BCEvent, Sequelize);

// SIGNAL HANDLER

function signalHandler(SIGNAL) {
    console.log("Received", SIGNAL);
    Scraper.pause();
    wait(1000).then(
        async () => { await Scraper.finish(); }
    ).finally(() => {
        console.log("Exit!");
        process.exit();
    });
    wait(20000).then(() => {
        process.exit(10);
    });
    return 1;
}

process.on("SIGINT", signalHandler);
process.on("SIGTERM", signalHandler);

// JOB

let promise = sequelize.authenticate().then(() => {
    return sequelize.sync({ logging: false });
}).catch(err => {
    console.log("Database error:", err);
    process.exit(1);
}).then(() => {
    console.log("Database OK");
    Scraper.initialize();
});


promise = promise.then(
    async () => await Scraper.collect('', '')
);

const other_collections = [
    { c: "eg5", r: "" },
    { c: "eg2", r: "" },
    { c: "", r: "V" },
];

for (const p of other_collections) {
    console.log(p);
    promise = promise.then(
        async (r) => {
            l = await Scraper.collect(p.c, p.r);
            return r.concat(l);
        }
    );
};

promise.catch(
    (e) => {
        console.log("Error during collection", e);
        process.exit(1);
    }
).then(
    async (r) => {
        if (r.length) {
            return await axios.get(APP_URL)
        };
    }
).then(
    (r) => {
        console.log("Wake up app to send watchers");
        process.exit(0);
    }, (e) => {
        console.log("Http request error:", e);
        process.exit(2);
    }
);
