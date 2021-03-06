BuonacacciaBot
==============

[@agnoBuonacacciaBot](https://t.me/agnoBuonacacciaBot)
-------------------------

### Descrition

A Telegream Bot created to help people dealing with [buonacaccia.net](https://buonacaccia.net/), a site used by Italian scouts and guides to subscribe to organized events.

The bot is a program for node.js that uses the [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api/) package.

This bot periodically collects the list of events through a process of web-scraping and save it to a SQL database. Telegram user can search the database for selected events or ask to get a notification when an event of a given type shows up. The telegram will also provide notification before the subscription start date and before the event start date.

I run this on Heroku.

### Development

Still in progress.

- Notification before subscription start date and event start date are to be tested.
- The notification on new events are to be tested properly.
- The bot does not handle well telegram errors, e.g. those that arise if the bot is stopped by telegram users
- The bot does not update his database

### Setup

- Create a telegram bot
- Get the api token and save it to the `TELEGRAM_API_TOKEN` enviroment variable
- If you run the bot on a serve that might idle you server add the app path to the `APP_URL` enviroment variable
- Provide a PostgreSQL db and the connection information as the `DATABASE_URL` env variable
- Run `node db-setup.js` to set up the database
- Run `node app.js` to start the bot
- If running on Heroku then set up a way to periodicaly search for event: either set up the `KEEP_UP` to always run the app (consume heroku time); or setup your server to hourly run `node job.js`
- If running on Heroku then set up a way to send event alarm:: either set up the `KEEP_UP` to always run the app; or setup your server to run `node wake.js` at 8:00 CET and 17:00 CET.