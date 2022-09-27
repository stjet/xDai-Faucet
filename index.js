const express = require('express');
const axios = require('axios');
const nunjucks = require('nunjucks');

const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');

const mongo = require('./database.js');

const xdai = require('./xdai.js');

let db = mongo.getDb();
let collection;
//collection.find({}).forEach(console.dir)
db.then((db) => {collection = db.collection("claims_info"); 
});

nunjucks.configure('templates', { autoescape: true });

async function insert(addr, timestamp) {
  await collection.insertOne({"address": addr, "last_claim": timestamp});
}

async function replace(addr, newtimestamp) {
  await collection.replaceOne({"address": addr}, {"address": addr, "last_claim": newtimestamp});
}

async function find(addr) {
  return await collection.findOne({"address": addr});
}

async function count(query) {
  return await collection.count(query);
}

const app = express();

app.use(express.static('files'));

app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());

app.use(cookieParser());

const claim_freq = 86400000;

const faucet_addr_xdai = "0x6e49e60f7228b6cc9883c89811266d212092a8aa"

app.get('/', async function (req, res) {
  let errors = false;
  let address = false;
  let given = false;
  //render template 
  return res.send(nunjucks.render('xdai.html', {error: false, address: false, given: false, faucet_addr: faucet_addr_xdai}));
})

app.post('/', async function (req, res) {
  let address = req.body['addr'];

  let current_bal = await xdai.check_bal(faucet_addr_xdai);
  let amount = "0.001"; 

  if (req.cookies['xdai_last_claim']) {
    if (Number(req.cookies['xdai_last_claim'])+claim_freq > Date.now()) {
      return res.send(nunjucks.render("xdai.html", {error: "Last claim too soon", address: address, given: false, faucet_addr: faucet_addr_xdai}));
    }
  }

  let token = req.body['h-captcha-response'];
  let params = new URLSearchParams();
  params.append('response', token);
  params.append('secret', process.env.secret);
  let captcha_resp = await axios.post('https://hcaptcha.com/siteverify', params);
  captcha_resp = captcha_resp.data;

  if (!captcha_resp['success']) {
    return res.send(nunjucks.render('xdai.html', {error: "Failed captcha", address: address, given: false, faucet_addr: faucet_addr_xdai}));
  }

  let dry = await xdai.faucet_dry(faucet_addr_xdai);

  if (dry) {
    return res.send(nunjucks.render('xdai.html', {error: "Faucet dry", address: address, given: false, faucet_addr: faucet_addr_xdai}));
  }

  let db_result = await find(address);
  if (db_result) {
    db_result = db_result['last_claim'];
    if (Number(db_result)+claim_freq < Date.now()) {
      send = await xdai.send_xdai(address, amount);
      if (send == false) {
        return res.send(nunjucks.render('xdai.html', {error: "Send failed", address: address, given: false, faucet_addr: faucet_addr_xdai}));
      }
      res.cookie('xdai_last_claim', String(Date.now()));
      await replace(address,String(Date.now()));
      return res.send(nunjucks.render('xdai.html', {error: false, address: address, given: true, faucet_addr: faucet_addr_xdai}));
    } else {
      return res.send(nunjucks.render('xdai.html', {error: "Last claim too soon", address: address, given: false, faucet_addr: faucet_addr_xdai}));
    }
  }

  send = await xdai.send_xdai(address, amount);
  if (send == false) {
    return res.send(nunjucks.render('xdai.html', {error: "Send Failed", address: address, given: false, faucet_addr: faucet_addr_xdai}));
  }
  res.cookie('xdai_last_claim', String(Date.now()));
  await insert(address,String(Date.now()));
  return res.send(nunjucks.render('xdai.html', {error: false, address: address, given: true, faucet_addr: faucet_addr_xdai}));
})

app.listen(8081, async () => {
  console.log(`App on`)
});
