'use strict';
var self = ci;
module.exports = self;

function ci(externalBag, callback) {
  logger.debug('mylog inside ci');
  return callback();
}
