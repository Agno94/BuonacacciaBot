const ZONES = {};
ZONES.LIST = [
    {
        code: 0,
        human: "Nazionale"
    }, {
        code: 1,
        human: "Nord"
    }, {
        code: 2,
        human: "Centro"
    }, {
        code: 3,
        human: "Sud"
    }, {
        code: 4,
        human: "Isole"
    },
];

const REGIONI = {};
REGIONI.LIST = [
    {
        bccode: 'A',
        bchuman: 'Nazionale',
        code: 'A',
        human: 'Nazionale',
        zone: 0
    }, {
        bccode: 'B',
        bchuman: 'Abruzzo',
        code: 'B',
        human: 'Abruzzo',
        zone: 2
    }, {
        bccode: 'C',
        bchuman: 'Basilicata',
        code: 'C',
        human: 'Basilicata',
        zone: 3
    }, {
        bccode: 'D',
        bchuman: 'Calabria',
        code: 'D',
        human: 'Calabria',
        zone: 3
    }, {
        bccode: 'E',
        bchuman: 'Campania',
        code: 'E',
        human: 'Campania',
        zone: 3
    }, {
        bccode: 'F',
        bchuman: 'EmiRo',
        code: 'F',
        human: 'Emilia Romagna',
        zone: 1
    }, {
        bccode: 'G',
        bchuman: 'FVG',
        code: 'G',
        human: 'Friuli Venezia Giulia',
        zone: 1
    }, {
        bccode: 'H',
        bchuman: 'Lazio',
        code: 'H',
        human: 'Lazio',
        zone: 2
    }, {
        bccode: 'I',
        bchuman: 'Liguria',
        code: 'I',
        human: 'Liguria',
        zone: 1
    }, {
        bccode: 'L',
        bchuman: 'Lombardia',
        code: 'L',
        human: 'Lombardia',
        zone: 1
    }, {
        bccode: 'M',
        bchuman: 'Marche',
        code: 'M',
        human: 'Marche',
        zone: 2
    }, {
        bccode: 'N',
        bchuman: 'Molise',
        code: 'N',
        human: 'Molise',
        zone: 3
    }, {
        bccode: 'O',
        bchuman: 'Piemonte',
        code: 'O',
        human: 'Piemonte',
        zone: 1
    }, {
        bccode: 'P',
        bchuman: 'Puglia',
        code: 'P',
        human: 'Puglia',
        zone: 3
    }, {
        bccode: 'Q',
        bchuman: 'Sardegna',
        code: 'Q',
        human: 'Sardegna',
        zone: 4
    }, {
        bccode: 'R',
        bchuman: 'Sicilia',
        code: 'R',
        human: 'Sicilia',
        zone: 4
    }, {
        bccode: 'S',
        bchuman: 'Toscana',
        code: 'S',
        human: 'Toscana',
        zone: 2
    }, {
        bccode: 'T',
        bchuman: 'TAA',
        code: 'T',
        human: 'Trentino Alto Adige',
        zone: 1
    }, {
        bccode: 'U',
        bchuman: 'Umbria',
        code: 'U',
        human: 'Umbria',
        zone: 2
    }, {
        bccode: 'V',
        bchuman: 'Valle d&#39;Aosta',
        code: 'V',
        human: 'Valle d\'Aosta',
        zone: 1
    }, {
        bccode: 'Z',
        bchuman: 'Veneto',
        code: 'Z',
        human: 'Veneto',
        zone: 1
    }];

const BRANCHE = {};
BRANCHE.LIST = [
    {
        code: 1,
        human: "L/C",
        img: "lc",
        emoji: "🐺🐞",
    }, {
        code: 2,
        human: "E/G",
        img: "eg",
        emoji: "🏕🐉️"
    }, {
        code: 3,
        human: "R/S",
        img: "rs",
        emoji: "🥾❤️"
    }, {
        code: 4,
        human: "Campi Formazione",
        img: "fc",
        emoji: "⚜️"
    }, {
        code: 5,
        human: "Form. Permanente",
        img: "fc",
        emoji: "🧩"
    }, {
        code: 6,
        human: "Altro",
        img: "aa",
        emoji: "▫️"
    }
];

const CATEGORIES = {};
CATEGORIES.LIST = [
    {
        branca: 1,
        code: 'lc0',
        bccode: '10',
        human: 'L/C Vari',
        bcgridhuman: '',
    }, {
        branca: 1,
        code: 'lc1',
        bccode: '11',
        human: 'Piccole Orme',
        bcgridhuman: 'PO',
    }, {
        branca: 1,
        code: 'lc9',
        bccode: '19',
        human: 'Capi in L/C',
        bcgridhuman: 'CapiLC',
    }, {
        branca: 2,
        code: 'eg0',
        bccode: '20',
        human: 'E/G Vari',
        bcgridhuman: '',
    }, {
        branca: 2,
        code: 'eg1',
        bccode: '21',
        human: 'Campi di Specialità',
        bcgridhuman: 'Spec',
    }, {
        branca: 2,
        code: 'eg2',
        bccode: '22',
        human: 'Capi Squadriglia',
        bcgridhuman: '??',
    }, {
        branca: 2,
        code: 'eg4',
        bccode: '24',
        human: 'Specialità di Squadriglia',
        bcgridhuman: 'SpecSq',
    }, {
        branca: 2,
        code: 'eg5',
        bccode: '25',
        human: 'Campi di Competenza',
        bcgridhuman: '??',
    }, {
        branca: 2,
        code: 'eg9',
        bccode: '29',
        human: 'Capi in E/G',
        bcgridhuman: 'CapiEG',
    }, {
        branca: 3,
        code: 'rs0',
        bccode: '30',
        human: 'R/S Vari',
        bcgridhuman: '',
    }, {
        branca: 3,
        code: 'rs1',
        bccode: '31',
        human: 'ROSS',
        bcgridhuman: 'ROSS',
    }, {
        branca: 3,
        code: 'rs2',
        bccode: '32',
        human: 'Uscita Partenti',
        bcgridhuman: 'Part',
    }, {
        branca: 3,
        code: 'rs3',
        bccode: '33',
        human: 'EPPPI',
        bcgridhuman: 'EPPPI',
    }, {
        branca: 3,
        code: 'rs9',
        bccode: '39',
        human: 'Capi in R/S',
        bcgridhuman: 'CapiRS',
    }, {
        branca: 4,
        code: 'cf0',
        bccode: '40',
        human: 'Formazione Capi',
        bcgridhuman: 'non presente',
    }, {
        branca: 4,
        code: 'cft',
        bccode: '41',
        human: 'CFT',
        bcgridhuman: 'CFT',
    }, {
        branca: 4,
        code: 'cfm1',
        bccode: '42',
        human: 'CFM L\/C',
        bcgridhuman: 'CFM L\/C',
    }, {
        branca: 4,
        code: 'cfm2',
        bccode: '43',
        human: 'CFM E\/G',
        bcgridhuman: 'CFM E/G',
    }, {
        branca: 4,
        code: 'cfm3',
        bccode: '44',
        human: 'CFM R\/S',
        bcgridhuman: 'CFM R/S',
    }, {
        branca: 4,
        code: 'cam1',
        bccode: '45',
        human: 'CAM L\/C',
        bcgridhuman: 'CAM L/C',
    }, {
        branca: 4,
        code: 'cam2',
        bccode: '46',
        human: 'CAM E\/G',
        bcgridhuman: 'CAM E/G',
    }, {
        branca: 4,
        code: 'cam3',
        bccode: '47',
        human: 'CAM R\/S',
        bcgridhuman: 'CAM R/S',
    }, {
        branca: 4,
        code: 'cfa',
        bccode: '48',
        human: 'CFA',
        bcgridhuman: 'CFA',
    }, {
        branca: 5,
        code: 'fp0',
        bccode: '50',
        human: 'Formazione Permanente',
        bcgridhuman: '',
    }, {
        branca: 5,
        code: 'fp1',
        bccode: '51',
        human: 'Laboratori',
        bcgridhuman: 'Lab',
    }, {
        branca: 5,
        code: 'fp2',
        bccode: '52',
        human: 'CAEX',
        bcgridhuman: 'CAEX',
    }, {
        branca: 5,
        code: 'fp3',
        bccode: '53',
        human: 'CCG',
        bcgridhuman: 'CCG',
    }, {
        branca: 5,
        code: 'fp4',
        bccode: '54',
        human: 'Formatori',
        bcgridhuman: 'Form',
    }, {
        branca: 5,
        code: 'fp5',
        bccode: '55',
        human: 'Eventi Fede',
        bcgridhuman: 'Fede',
    }, {
        branca: 6,
        code: 'extra',
        bccode: '60',
        human: 'Speciale',
        bcgridhuman: '',
    }
]

//ZONES.REGIONI = {};
ZONES.LIST.forEach(element => {
    ZONES[element.code] = element;
    element.REGIONI = [];
    element.SET = new Set();
});

REGIONI.BCHUMAN2CODE = {};
REGIONI.CHOICES = [];
REGIONI.BCCODE2CODE = {};
// REGIONI.CODE2BCCODE = {};
REGIONI.HUMAN2CODE = {};
REGIONI.COMMAND2CODE = {};
// REGIONI.CODE2HUMAN = {};

REGIONI.LIST.forEach(element => {
    REGIONI[element.code] = element;
    element.command = element.human.replace(/[' ]/g, "").toLowerCase();

    // ZONES[element.zone].REGIONI.push(element.code);
    ZONES[element.zone].REGIONI.push(element);
    ZONES[element.zone].SET.add(element.code);

    REGIONI.BCHUMAN2CODE[element.bchuman] = element.code;
    REGIONI.HUMAN2CODE[element.human] = element.code;
    REGIONI.COMMAND2CODE[element.command] = element.code;
    REGIONI.CHOICES.push(element.code);
    REGIONI.BCCODE2CODE[element.bccode] = element.code;


    // ZONES.REGIONI[element.zone].push(element.code);

    // REGIONI.CODE2BCCODE[element.code] = element.bccode;
    // REGIONI.CODE2HUMAN[element.code] = element.human;
});
REGIONI.SET = new Set(REGIONI.CHOICES);

BRANCHE.LIST.forEach(element => {
    BRANCHE[element.code] = element;
    element.CATEGORIES = [];
    element.SET = new Set();
});

CATEGORIES.BCGRID2CODE = {};
// CATEGORIES.CODE2BCCODE = {};
// CATEGORIES.CODE2HUMAN = {};
CATEGORIES.BCCODE2CODE = {};
CATEGORIES.CHOICES = [];
// CATEGORIES.FROMCODE = {};
CATEGORIES.IMG2CODE = {};
CATEGORIES.LIST.forEach(element => {
    CATEGORIES[element.code] = element;
    // BRANCHE[element.branca].CATEGORIES.push(element.code);
    BRANCHE[element.branca].CATEGORIES.push(element);
    BRANCHE[element.branca].SET.add(element.code);
    if (element.bcgridhuman) {
        CATEGORIES.BCGRID2CODE[element.bcgridhuman] = element.code;
    } else {
        let branca = BRANCHE.LIST[element.branca - 1];
        CATEGORIES.IMG2CODE[branca.img] = element.code;
    }
    // CATEGORIES.FROMCODE[element.code] = element;
    // CATEGORIES.CODE2BCCODE[element.code] = element.bccode;
    // CATEGORIES.CODE2HUMAN[element.code] = element.human;
    CATEGORIES.BCCODE2CODE[element.bccode] = element.code;
    CATEGORIES.CHOICES.push(element.code);
});
CATEGORIES.SET = new Set(CATEGORIES.CHOICES);

const COLLECTIONS = {
    SPECIALS: [
        { c: "eg5", r: "" },
        { c: "eg2", r: "" },
        { c: "", r: "V" },
    ],
    EXEC_TIME: new Set([6, 9, 12, 15, 18, 21]),
}


module.exports = { REGIONI, ZONES, CATEGORIES, BRANCHE, COLLECTIONS }