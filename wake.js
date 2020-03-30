const axios = require('axios');

const APP_URL = process.env.APP_URL || "";

axios.get(APP_URL).then(response => {
    console.log("App is awake");
    process.exit(0);
}, error => {
    console.error("Error:", error);
    process.exit(1);
});
