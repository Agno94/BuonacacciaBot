const cheerio = require('cheerio')
const axios = require('axios')
const https = require('https');

const { REGIONI, ZONES, CATEGORIES, BRANCHE } = require("./data.js");


function wait(ms) {
    return new Promise(r => setTimeout(r, ms));
}

const REGEXP_DATE = /[^0-9]*([0-9]*)\/([0-9]*)\/([0-9]*).*/;
const REGEXP_CAT_IMG = /Images\/branch_([a-z]*).png/;
const REGEXP_EVENT_URL = /event.aspx\?e\=([0-9]*)/;
const REGEXP_COST = /[^0-9]*([0-9,]*)[ ]*€.*/;
const REGEXP_SubsStart =
    /MainContent_EventFormView_lbSubsFrom[^>]*>[ ]*([0-9]*)\/([0-9]*)\/([0-9]*)[ ]*</;
const REGEXP_SubsEnd =
    /MainContent_EventFormView_lbSubsTo[^>]*>[ ]*([0-9]*)\/([0-9]*)\/([0-9]*)[ ]*</;

const BC_EVENTSGRID_URL = "https://buonacaccia.net/Events.aspx"
const BC_EVENTDETAIL_URL = "https://buonacaccia.net/event.aspx"

class EventScraper {

    constructor(BCEvent, BCLog, Sequelize, profile = true) {
        this.Op = Sequelize.Op;
        this.BCEvent = BCEvent;
        this.BCLog = BCLog;
        this.activeEvents = new Set();
        this.is_paused = false;
        this.is_collection_running = false;
        this.is_collection_scheduled = false;
        this.is_ready = false;
        this.profile = profile;
        // this.collection = {};
        this.today = new Date(new Date().toDateString());
    }

    pause(s) {
        this.is_paused = ((s == undefined) && (!this.is_paused)) || s
    }

    initialize() {
        return this.BCEvent.findAll({
            where: {
                startdate: { [this.Op.gte]: this.today }
            },
            attributes: ['bcId']
        }).then(
            (r) => r.map((x) => x.bcId)
        ).then((r) => {
            r.forEach(
                (item) => {
                    this.activeEvents.add(item);
                })
            this.is_ready = true;
        }).catch(e => {
            console.log("Inizialing known active event set failed");
            console.log(e);
        });
    }

    log(...args) {
        if (this.is_collection_running) {
            console.log(" *", ...args);
        } else {
            console.log(...args);
        }
    }

    async finish() {
        while (this.is_collection_running) {
            this.log("Waiting for a running collection to be finished")
            await wait(1000);
        }
    }

    async _wait_and_set_params(cat, reg) {
        while (!this.is_ready) {
            this.log("Waiting to be ready")
            await wait(500);
        }
        await this.finish();
        this.category = (CATEGORIES.SET.has(cat) && cat) || '';
        this.regione = (REGIONI.SET.has(reg) && reg) || '';
        this.log(`Starting collection of data from buonacaccia.net with cat:${this.category} and reg:${this.regione}`);
        this.is_collection_running = true;
        this.is_collection_scheduled = false;
        return 0;
    }

    is_event_id_relevant(event_id) {
        return (event_id) && (!this.activeEvents.has(event_id));
    }

    _event_list_parser(htmldata) {
        let parsing_start_time = new Date();
        const $ = cheerio.load(htmldata);
        let entry_list = [];
        // Find the main events grid and
        // produce a list of links, one for each event
        const links = $("#MainContent_EventsGridView").find("a")
        links.each((i, link) => {
            // GET BC EVENT ID
            let event_url = link.attribs.href;
            let event_id;
            try {
                event_id = Number(REGEXP_EVENT_URL.exec(event_url)[1]);
                if (!event_id) {
                    throw "Wrong event id" + event_url;
                }
            } catch (e) {
                this.log("Link parsing error: ", e, $(link).html());
            }
            if (this.is_event_id_relevant(event_id)) {
                let item = $(link).parent().parent()
                let entry = {
                    bcId: event_id,
                    regione: this.regione,
                    category: this.category
                };
                this.log(`Found event #${event_id} at ${event_url}`);
                // Produce the list of the cells of a given row
                let cells = $(item).find("td");
                try {
                    // GET BRANCA AND CATEGORY
                    if (!entry.category) {
                        let category_img = cells[1].children[0].attribs.src;
                        let category_branca = REGEXP_CAT_IMG.exec(category_img)[1];
                        let category_human = $(cells[2]).text().trim();

                        entry.category =
                            category_human ? CATEGORIES.BCGRID2CODE[category_human] :
                                CATEGORIES.IMG2CODE[category_branca];
                        if (!entry.category) {
                            throw "Unrecognized category" + category_human
                        }
                    }
                    // GET REGIONE
                    if (!entry.regione) {
                        let regione_human = $(cells[4]).text().trim();
                        entry.regione = REGIONI.BCHUMAN2CODE[regione_human];
                    }
                    // TITLE AND LOCATION
                    entry.title = $(cells[3]).text().trim();
                    entry.location = $(cells[8]).text().trim();
                    // START AND AND DATE
                    let match = REGEXP_DATE.exec($(cells[5]).text());
                    entry.startdate = new Date(`${match[3]}-${match[2]}-${match[1]}`);
                    match = REGEXP_DATE.exec($(cells[6]).text());
                    entry.enddate = new Date(`${match[3]}-${match[2]}-${match[1]}`);;
                    // COST
                    let raw_cost = $(cells[7]).text().trim();
                    if (raw_cost == '-') {
                        entry.cost = 0;
                    } else {
                        match = REGEXP_COST.exec(raw_cost);
                        entry.cost = Math.floor(Number(match[1].replace(",", ".")) * 100);
                    }
                    entry_list.push(entry);
                } catch (e) {
                    console.error("Row parsing error: ", e);
                }
            } else {
                //console.log(`Discharged not relevant event #${event_id}`);
            }
        });
        this.log(`EventGrid: parser found ${entry_list.length} events`);
        this.collection.number_grid_events = entry_list.length;
        this.collection.time.EGparse = new Date() - parsing_start_time;
        return entry_list
    }

    _event_page_parser(entry, htmldata) {
        let match;
        match = REGEXP_SubsStart.exec(htmldata);
        entry.subscriptiondate = new Date(`${match[3]}-${match[2]}-${match[1]}`);
        match = REGEXP_SubsEnd.exec(htmldata);
        entry.endsubscriptiondate = new Date(`${match[3]}-${match[2]}-${match[1]}`);
        return entry
    }

    async _do_request_and_retry(request, tries, timeout, msg) {
        const accepted_errors = new Set(["ECONNABORTED", "ETIMEDOUT"]);
        let still_to_try = tries || 1;
        request.timeout = timeout || 0;
        let token = { exec: null, done: false };
        while (still_to_try) {
            still_to_try--;
            if (this.is_paused) return [false, ""];
            token.cancelled = false;
            request.cancelToken = new axios.CancelToken(c => { token.exec = c });
            if (timeout) {
                setTimeout(() => {
                    if (!token.done) {
                        token.cancelled = true;
                        token.exec();
                        return 0;
                    }
                }, 2 * timeout);
            }
            try {
                let response = await axios(request);
                token.done = true;
                if (response.data) {
                    return [false, response.data];
                }
            } catch (e) {
                await wait(5);
                if (!accepted_errors.has(e.code) && !token.cancelled) {
                    console.error(msg || '', `Unhandeled error`, e);
                    throw "ERROR";
                }
            }
            this.log(msg || '', `Try #${tries - still_to_try} failed`);
            await wait(500);
        }
        throw "FAILED_EVERY_TIMES";
    }

    async _complete_event_detail(entry, index, list) {
        let request = {
            method: "get",
            url: BC_EVENTDETAIL_URL,
            params: { e: entry.bcId },
            headers: { 'Connection': 'keep-alive' },
            httpsAgent:
                new https.Agent({ keepAlive: true })
        };
        await wait(3 * index);
        if (this.is_paused) {
            list[index] = false;
            return;
        }
        // TRIES TO GET THE PAGE UP TO tries TIMES
        await this._do_request_and_retry(request, 4, 4000, `Event Detail #${index}:`).then(
            ([err, data]) => {
                //entry.collectiondate = this.start_time;
                list[index] = this._event_page_parser(entry, data);
                return data;
            }, (e) => {
                this.log(index, "Detail fetch failed");
                list[index] = false;
            }).catch((e) => {
                console.error(index, "Parse error", e);
                list[index] = false;
            })
    }

    async _bc_event_grid() {
        // GET EVENT GRID PAGE
        let [err, data] = await this._do_request_and_retry({
            method: "get",
            params: {
                CID: (CATEGORIES[this.category] && CATEGORIES[this.category].bccode) || "",
                RID: (REGIONI[this.regione] && REGIONI[this.regione].bccode) || "",
            },
            url: BC_EVENTSGRID_URL,
        }, 3, 50 * 1000, "EventGrid").catch(err => [err, false]);
        if (err) {
            this.log("Unable to retrieve the main events' grid's page - Aborting");
            this.collection.exit_status = "NET_ERROR";
            throw Error("NET_ERROR");
            //this.is_collection_running = false;
            //return [];
        }
        this.log(`EventGrid: Recieved a ${data.length} long response`);
        this.collection.time.EGfetch = new Date() - this.start_time;
        // PARSE EVENT GRID PAGE
        try {
            this.collection.event_list = this._event_list_parser(data);
        } catch (e) {
            throw Error("PARSE_ERROR");
        }
    }

    async _bc_event_detail() {
        // FOR EACH EVENT GET EVENT'S DETAIL
        let detail_start_time = new Date(); //PROFILER
        let event_list = this.collection.event_list;
        let promises = event_list.map(
            async (entry, index, list) => {
                entry.collectiondate = this.start_time;
                return this._complete_event_detail(entry, index, list);
            }
        );
        // WAIT FOR THE OPERATIONS TO BE COMPLETED
        for (const entry of promises) {
            await entry;
        };
        event_list = event_list.filter(
            entry => {
                if (!entry) { return false };
                entry.collectiondate = this.start_time;
                return Boolean(entry.bcId)
            }
        );
        this.collection.event_list = event_list;
        this.log(`EventDetail: ${event_list.length} events`);
        this.collection.number_detailed_events = event_list.length;
        this.collection.time.EDtime = new Date() - detail_start_time;
    }

    async _update_database() {
        // UPDATE DATABASE
        let database_start_time = new Date();
        let len = await this.BCEvent.bulkCreate(this.collection.event_list).then(
            (r) => {
                this.log("Database updated successfuly");
                this.collection.time.DBtime = new Date() - database_start_time;
                r.forEach((x) => {
                    this.activeEvents.add(x.bcId);
                });
                // return r.map((x) => x.bcId);
                return r.length
            }, e => {
                console.error("Database update error", e.name, e.message);
                this.exit_status = "DB_ERROR";
                throw "DB_ERROR";
            });
        // IDList.forEach((item) => {

        // });
        this.collection.number_db_events = len;
    }

    async collect(cat, reg) {
        await this._wait_and_set_params(cat, reg);
        if (this.is_paused) {
            this.log("Collections are paused, aborting");
            this.is_collection_running = false;
            return []
        }
        this.start_time = new Date();
        this.collection = {
            exit_status: "OTHER_ERROR",
            time: {},
        };
        try {
            await this._bc_event_grid();
            await this._bc_event_detail();
            await this._update_database().catch((e) => console.log(e));
            if (this.collection.number_grid_events > this.collection.number_db_events) {
                this.collection.exit_status = "INCOMPLETE";
            } else {
                this.collection.exit_status = "OK";
            }
        } catch (e) {
            this.collection.event_list = [];
            console.error("Error", this.collection.exit_status);
        }
        let event_list = this.collection.event_list;
        // delete this.collection.event_list;
        // console.log(this.collection);
        if (!this.is_paused || this.collection.number_db_events) {
            await this.BCLog.create({
                status: this.collection.exit_status,
                special: Boolean(cat || reg)
            }).then((r) => {
                this.log(`Collection entry log added with status ${r.status}`);
            }, (e) => {
                console.error("Error adding collection entry log", e.name, e.message);
            });
        }
        this.collection.time.total = new Date() - this.start_time;
        if (this.profile) this.log("Time in milliseconds: ", this.collection.time);
        delete this.collection;
        this.is_collection_running = false;
        return event_list;
    }
}

module.exports = EventScraper
