'use strict';

var self = initJob;
module.exports = self;

var getStatusCodeByName = require('../_common/getStatusCodeByName.js');

function initJob(externalBag, callback) {
  var bag = {
    consoleAdapter: externalBag.consoleAdapter,
    rawMessage: _.clone(externalBag.rawMessage),
    builderApiAdapter: externalBag.builderApiAdapter,
    nodeId: global.config.nodeId
  };
  bag.who = util.format('%s|job|%s', msName, self.name);
  logger.info(bag.who, 'Inside');

  async.series([
      _checkInputParams.bind(null, bag),
      _validateIncomingMessage.bind(null, bag),
      _getBuildJobStatus.bind(null, bag),
      _validateDependencies.bind(null, bag),
      _updateNodeIdInBuildJob.bind(null, bag),
      _getBuildJobPropertyBag.bind(null, bag)
    ],
    function (err) {
      var result;
      if (err) {
        logger.error(bag.who, util.format('Failed to init job'));
      } else {
        logger.info(bag.who, util.format('Successfully init job'));
        result= {
          inPayload: bag.inPayload,
          isCI: bag.isCI,
          buildJobId: bag.buildJobId,
          buildId: bag.buildId,
          jobId: bag.jobId,
          resourceId: bag.resourceId,
          buildNumber: bag.buildNumber,
          buildJobPropertyBag: bag.buildJobPropertyBag,
          projectId: bag.projectId,
          nodeId: bag.nodeId,
          statusCode: bag.statusCode,
          isJobCancelled: bag.isJobCancelled
        };
      }

      return callback(err, result);
    }
  );
}

function _checkInputParams(bag, next) {
  var who = bag.who + '|' + _checkInputParams.name;
  logger.verbose(who, 'Inside');

  if (_.isEmpty(bag.consoleAdapter)) {
    logger.error(util.format('%s, Missing consoleAdapter.', who));
    return next(true);
  }

  return next();
}

function _validateIncomingMessage(bag, next) {
  var who = bag.who + '|' + _validateIncomingMessage.name;
  logger.verbose(who, 'Inside');

  bag.consoleAdapter.openCmd('Validating incoming message');

  // We don't know where the group will end so need a flag
  bag.isInitializingJobGrpSuccess = true;
  var consoleErrors = [];

  if (_.isEmpty(bag.rawMessage))
    consoleErrors.push(util.format('%s is missing: rawMessage', who));

  if (bag.rawMessage) {
    if (_.isEmpty(bag.rawMessage.payload))
      consoleErrors.push(util.format('%s is missing: payload', who));

    if (bag.rawMessage.payload) {
      bag.inPayload = bag.rawMessage.payload;

      if (!bag.inPayload.type)
        consoleErrors.push(util.format('%s is missing: payload.type', who));
      else
        bag.isCI = bag.inPayload.type === 'runCI';

      if (!bag.isCI) {
        if (!bag.rawMessage.buildJobId)
          consoleErrors.push(util.format('%s is missing: buildJobId', who));
        bag.buildJobId = bag.rawMessage.buildJobId;

        if (!bag.inPayload.buildId)
          consoleErrors.push(
            util.format('%s is missing: payload.buildId', who)
          );
        bag.buildId = bag.inPayload.buildId;

      } else {
        if (!bag.rawMessage.jobId)
          consoleErrors.push(util.format('%s is missing: jobId', who));
        bag.jobId = bag.rawMessage.jobId;
      }

      if (!bag.inPayload.resourceId)
        consoleErrors.push(
          util.format('%s is missing: inPayload.resourceId', who)
        );
      bag.resourceId = bag.inPayload.resourceId;

      if (!bag.inPayload.buildNumber)
        consoleErrors.push(
          util.format('%s is missing: inPayload.buildNumber', who));
      bag.buildNumber = bag.inPayload.buildNumber;

      if (!bag.inPayload.name)
        consoleErrors.push(util.format('%s is missing: inPayload.name', who));

      if (!bag.inPayload.subscriptionId)
        consoleErrors.push(
          util.format('%s is missing: inPayload.subscriptionId', who)
        );

      if (!bag.inPayload.secretsToken)
        consoleErrors.push(
          util.format('%s is missing: inPayload.secretsToken', who)
        );

      if (!_.isObject(bag.inPayload.propertyBag))
        consoleErrors.push(
          util.format('%s is missing: inPayload.propertyBag', who)
        );
      bag.buildJobPropertyBag = bag.inPayload.propertyBag;

      if (!_.isArray(bag.inPayload.dependencies))
        consoleErrors.push(
          util.format('%s is missing: inPayload.dependencies', who)
        );

      bag.projectId = bag.inPayload.projectId;
    }
  }

  if (consoleErrors.length > 0) {
    _.each(consoleErrors,
      function (e) {
        bag.consoleAdapter.publishMsg(e);
      }
    );
    bag.consoleAdapter.closeCmd(false);
    return next(true);
  } else {
    bag.consoleAdapter.publishMsg('Successfully validated incoming message');
    bag.consoleAdapter.closeCmd(true);
  }
  return next();
}

function _getBuildJobStatus(bag, next) {
  var who = bag.who + '|' + _getBuildJobStatus.name;
  logger.verbose(who, 'Inside');

  bag.builderApiAdapter.getBuildJobById(bag.buildJobId,
    function (err, buildJob) {
      if (err) {
        var msg = util.format('%s, Failed to get buildJob' +
          ' for buildJobId:%s, with err: %s', who, bag.buildJobId, err);
        logger.warn(msg);
        bag.jobStatusCode = getStatusCodeByName('error', bag.isCI);
      }
      bag.isJobCancelled = false;
      if (buildJob.statusCode === getStatusCodeByName('cancelled', bag.isCI)) {
        bag.isJobCancelled = true;
        logger.warn(util.format('%s, Job with buildJobId:%s' +
          ' is cancelled', who, bag.buildJobId));
      }
      return next(err);
    }
  );
}

function _validateDependencies(bag, next) {
  var who = bag.who + '|' + _validateDependencies.name;
  logger.verbose(who, 'Inside');
  bag.consoleAdapter.openCmd('Validating job dependencies');

  var dependencyErrors = [];

  _.each(bag.inPayload.dependencies,
    function (dependency) {
      if (dependency.nonexistent)
        return dependencyErrors.push(
          util.format('%s dependency has been deleted from the yml ' +
            'or has no versions', dependency.name)
        );

      if (!dependency.name)
        dependencyErrors.push(
          util.format('%s dependency is missing :name', dependency)
        );

      if (!dependency.operation)
        dependencyErrors.push(
          util.format('%s dependency is missing :operation', dependency.name)
        );

      if (!dependency.resourceId)
        dependencyErrors.push(
          util.format('%s dependency is missing :resourceId', dependency.name)
        );

      if (!dependency.type)
        dependencyErrors.push(
          util.format('%s dependency is missing :type', dependency.name)
        );

      if (!_.isObject(dependency.propertyBag))
        dependencyErrors.push(
          util.format('%s dependency is missing :propertyBag', dependency.name)
        );

      if (!_.isObject(dependency.version) && dependency.operation !== 'OUT')
        dependencyErrors.push(
          util.format('%s, %s dependency is missing :version',
            who, dependency.name)
        );

      if (_.isObject(dependency.version) && dependency.operation !== 'OUT') {
        if (!dependency.version.versionId)
          dependencyErrors.push(
            util.format('%s dependency is missing :version.versionId',
              dependency.name)
          );

        if (!_.isObject(dependency.version.propertyBag))
          dependencyErrors.push(
            util.format('%s dependency is missing :version.propertyBag',
              dependency.name)
          );
      }

      if (!dependency.isConsistent)
        dependencyErrors.push(
          util.format('%s dependency is inconsistent', dependency.name)
        );

    }
  );

  if (dependencyErrors.length > 0) {
    _.each(dependencyErrors,
      function (e) {
        bag.consoleAdapter.publishMsg(e);
      }
    );
    bag.consoleAdapter.closeCmd(false);
    return next(true);
  } else {
    bag.consoleAdapter.publishMsg('Successfully validated ' +
      bag.inPayload.dependencies.length + ' dependencies');
    bag.consoleAdapter.closeCmd(true);
  }

  return next();
}

function _updateNodeIdInBuildJob(bag, next) {
  var who = bag.who + '|' + _updateNodeIdInBuildJob.name;
  logger.verbose(who, 'Inside');
  bag.consoleAdapter.openCmd('Updating node');

  var update = {
    nodeId: bag.nodeId
  };

  bag.builderApiAdapter.putBuildJobById(bag.buildJobId, update,
    function (err) {
      if (err) {
        var msg =
          util.format('%s, failed to :putBuildJobById for buildJobId: %s, %s',
            who, bag.buildJobId, err);

        bag.consoleAdapter.publishMsg(msg);
        bag.consoleAdapter.closeCmd(false);
        return next(err);
      } else {
        bag.consoleAdapter.closeCmd(true);
      }
      return next();
    }
  );
}

function _getBuildJobPropertyBag(bag, next) {
  var who = bag.who + '|' + _getBuildJobPropertyBag.name;
  logger.verbose(who, 'Inside');
  bag.consoleAdapter.openCmd('Parsing job properties');

  if (_.isEmpty(bag.buildJobPropertyBag.yml))
    bag.buildJobPropertyBag.yml = {};

  if (_.isEmpty(bag.buildJobPropertyBag.yml.on_success))
    bag.buildJobPropertyBag.yml.on_success = [];
  if (_.isEmpty(bag.buildJobPropertyBag.yml.on_failure))
    bag.buildJobPropertyBag.yml.on_failure = [];
  if (_.isEmpty(bag.buildJobPropertyBag.yml.always))
    bag.buildJobPropertyBag.yml.always = [];

  bag.consoleAdapter.publishMsg('Successfully parsed job properties');
  bag.consoleAdapter.closeCmd(true);
  return next();
}
