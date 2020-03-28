const cheerio = require('cheerio')
const axios = require('axios')
const https = require('https');

const { REGIONI, ZONES, CATEGORIES, BRANCHE } = require("./data.js");


function wait(ms) {
    return new Promise(r => setTimeout(r, ms));
}

REGEXP_DATE = /[^0-9]*([0-9]*)\/([0-9]*)\/([0-9]*).*/;
REGEXP_CAT_IMG = /Images\/branch_([a-z]*).png/;
REGEXP_EVENT_URL = /event.aspx\?e\=([0-9]*)/;
REGEXP_COST = /[^0-9]*([0-9,]*)[ ]*€.*/;
// span #MainContent_EventFormView_lbSubsFrom
// span #MainContent_EventFormView_lbSubsTo
REGEXP_SubsStart =
    /MainContent_EventFormView_lbSubsFrom[^>]*>[ ]*([0-9]*)\/([0-9]*)\/([0-9]*)[ ]*</;
REGEXP_SubsEnd =
    /MainContent_EventFormView_lbSubsTo[^>]*>[ ]*([0-9]*)\/([0-9]*)\/([0-9]*)[ ]*</;

BC_EVENTSGRID_URL = "https://buonacaccia.net/Events.aspx"
BC_EVENTDETAIL_URL = "https://buonacaccia.net/event.aspx"

class EventScraper {

    constructor(BCEvent, Sequelize, profile = true) {
        this.Op = Sequelize.Op;
        this.BCEvent = BCEvent;
        this.activeEvents = new Set();
        this.is_paused = false;
        this.is_collection_running = false;
        this.is_collection_scheduled = false;
        this.is_ready = false;
        this.profiler = { on: profile };
        this.today = new Date(new Date().toDateString());
    }

    pause(s) {
        this.is_paused = ((s == undefined) && (!this.is_paused)) || s
    }

    initialize() {
        this.BCEvent.findAll({
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
            console.log("Inizialing stored active event set failed");
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

    is_event_id_relevant(event_id) {
        return !this.activeEvents.has(event_id);
    }

    _event_list_parser(htmldata) {
        let parsing_start_time = new Date();
        const $ = cheerio.load(htmldata)
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
                    throw "* Wrong event id" + event_url;
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
                    this.log("Row parsing error: ", e);
                }
            } else {
                //console.log(`Discharged not relevant event #${event_id}`);
            }
        });
        this.log(`EventGrid: parser found ${entry_list.length} events`);
        this.profiler.EG_parse = new Date() - parsing_start_time
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

    async _do_request_and_retry(request, tries, timeout, msg) {
        const accepted_errors = new Set(["ECONNABORTED", "ETIMEDOUT"]);
        let still_to_try = tries || 1;
        request.timeout = timeout || 0;
        let token = { exec: null, done: false };
        while (still_to_try) {
            still_to_try--;
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
                    this.log(msg || '', `Unhandeled error`, e)
                    throw "ERROR";
                }
            }
            await wait(500);
            this.log(msg || '', `Try #${tries - still_to_try} failed`)
        }
        throw "FAILED_EVERY_TIMES";
    }

    async _event_detail(entry, index, list) {
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
            this.log("Collections are paused, skipping this event");
            list[index] = false;
            return;
        }
        // TRIES TO GET THE PAGE UP TO tries TIMES
        await this._do_request_and_retry(request, 4, 4000, index).then(
            ([err, data]) => {
                list[index] = this._event_page_parser(entry, data);
                return data;
            }, (e) => {
                this.log(index, "Detail fetch failed");
                list[index] = false;
            }).catch((e) => {
                this.log(index, "Parse error", e);
                list[index] = false;
            })
    }

    async collect(cat, reg) {
        await this._wait_and_set_params(cat, reg);
        if (this.is_paused) {
            this.log("Collections are paused, aborting");
            return []
        }
        this.start_time = new Date(); //PROFILER
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
            this.is_collection_running = false;
            return [];
        }
        this.log(`EventGrid: Recieved a ${data.length} long response`);
        this.profiler.EG_fetch = new Date() - this.start_time;
        // PARSE EVENT GRID PAGE
        let event_list = this._event_list_parser(data);
        // FOR EACH EVENT GET EVENT'S DETAIL
        let detail_start_time = new Date(); //PROFILER
        let promises = event_list.map(
            async (entry, index, list) => {
                return this._event_detail(entry, index, list);
            }
        );
        // WAIT FOR THE OPERATIONS TO BE COMPLETED
        for (const entry of promises) {
            await entry;
        };
        event_list = event_list.filter(
            entry => {
                if (!entry) { return false };
                entry.colletiondate = this.start_time;
                return Boolean(entry.bcId)
            }
        );
        this.log(`EventDetail: ${event_list.length} events`);
        this.profiler.ED_time = new Date() - detail_start_time
        // UPDATE DATABASE
        let database_start_time = new Date();
        let ok = await this.BCEvent.bulkCreate(event_list).then(
            (r) => {
                this.log("Database updated successfuly");
                return r.map((x) => x.bcId);
            }, e => {
                this.log("Database update error", e.name, e);
                this.log(JSON.stringify(event_list));
                return [];
            }).then((r) => {
                this.profiler.DB_time = new Date() - database_start_time;
                r.forEach((item) => {
                    this.activeEvents.add(item);
                })
                return Boolean(r);
            }).catch((e) => {
                this.log("Error: Update active event set failed", e);
            })
        this.profiler.total_time = new Date() - this.start_time;
        this.log("Time in milliseconds: ", this.profiler);
        this.is_collection_running = false;
        return (ok && event_list) || [];
        // TO DO : CALL WATCHER CONTROL
    }
}

module.exports = EventScraper
