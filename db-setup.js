const DATABASE_URL = process.env.DATABASE_URL;
const Sequelize = require('sequelize');
const Op = Sequelize.Op;

const sequelize = new Sequelize(DATABASE_URL, { define: { timestamps: false } });
sequelize.authenticate().then(() => {
    console.log("Database OK");
}).catch(err => {
    console.log("Database error:", err);
});
const { BCEvent, BCLog, Watcher, EventReply, ChatSession } = sequelize.import("./db.js");

console.log("Drop database");
sequelize.drop().then(async () => {
    console.log("Sync database");
    await sequelize.sync();
}).then(() => {
    console.log("Everything OK");
    process.exit(0);
}).catch((e) => {
    console.log("Error: ", e);
    process.exit(1);
});
