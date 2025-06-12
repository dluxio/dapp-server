require('dotenv').config();
const ENV = process.env;

const port = ENV.PORT || 3000;
const hapi = ENV.HAPI || "https://hive-api.dlux.io";
const ipfs = ENV.IPFS || "http://127.0.0.1:8080";
const img = ENV.IMG || "/img/dlux-icon-192.png"

module.exports = {
    port,
    hapi,
    ipfs,
    img
}