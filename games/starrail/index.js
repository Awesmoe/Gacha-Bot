const config = require('./config');
const api = require('./api');
const format = require('./format');
const observations = require('./observations');

module.exports = {
  ...config,
  api,
  format,
  observations,
};
