
/**
 * Module dependencies.
 */

var request = require('superagent')
  , exec = require('child_process').exec
  , debug = require('debug')('component-bot')
  , command = require('shelly')
  , http = require('http')
  , noop = function(){};

/**
 * Expose `Bot`.
 */

module.exports = Bot;

/**
 * Return an error for `res`.
 *
 * @param {Response} res
 * @return {Error}
 * @api private
 */

function error(res) {
  return new Error('got ' + res.status + ' "' + http.STATUS_CODES[res.status] + '" response');
}

/**
 * Initialize a new Bot with `user` / `pass`.
 *
 * @param {String} user
 * @param {String} pass
 * @api public
 */

function Bot(user, pass) {
  this.user = user;
  this.pass = pass;
  this.clonePath = 'clones';
}

/**
 * Fetch the bot's repos and invoke `fn(err, repos)`.
 *
 * @param {Function} fn
 * @api public
 */

Bot.prototype.repos = function(fn){
  debug('fetch repos');

  this
  .get('/user/repos')
  .end(function(res){
    if (res.error) return fn(error(res));
    fn(null, res.body);
  })
};

/**
 * Check if the bot has forked `repo` and invoke `fn(err, bool)`.
 *
 * TODO: assert user...
 *
 * @param {String} repo
 * @param {Function} fn
 * @api public
 */

Bot.prototype.hasForked = function(repo, fn){
  debug('has forked %s', repo);
  var name = repo.split('/').pop();
  this.repos(function(err, repos){
    if (err) return fn(err);
    for (var i = 0, len = repos.length; i < len; ++i) {
      if (repos[i].name == name) {
        return fn(null, true);
      }
    }
    fn(null, false);
  });
};

/**
 * Remove all repos and invoke `fn()`.
 *
 * @param {Function} fn
 * @api public
 */

Bot.prototype.removeAll = function(fn){
  debug('remove all repos');
  var self = this;
  fn = fn || noop;
  this.repos(function(err, repos){
    if (err) return fn(err);
    var pending = repos.length;
    repos.forEach(function(repo){
      self.remove(repo.name, function(){
        if (err) return fn(err);
        --pending || fn();
      });
    });
  });
};

/**
 * Remove repo `name` and invoke `fn(err)`.
 *
 * @param {String} name
 * @param {Function} [fn]
 * @api public
 */

Bot.prototype.remove = function(name, fn){
  debug('remove repo %s', name);
  fn = fn || noop;

  this
  .del('/repos/' + this.user + '/' + name)
  .end(function(res){
    if (res.error) return fn(error(res));
    fn();
  });
};

/**
 * Create an issue with the given `title`, `body`, and `options`.
 *
 *     bot
 *     .issue('visionmedia/superagent', 'Some issue', 'Check this out')
 *     .end(function(res){
 *       console.log(res.status);
 *       console.log(res.body);
 *     })
 *
 * @param {String} repo
 * @param {String} title
 * @param {String} body
 * @param {Object} [options]
 * @return {Request}
 * @api public
 */

Bot.prototype.issue = function(repo, title, body, options){
  debug('issue %s %s', repo, title);
  options = options || {};
  options.title = title;
  options.body = body;
  return this.post('/repos/' + repo + '/issues')
    .send(options)
};

/**
 * Commit to `repo` with the given `msg` and invoke `fn(err)`.
 *
 *    bot.commit('visionmedia/superagent', 'add license property to component.json');
 *
 * @param {String} repo
 * @param {String} msg
 * @param {Function} [fn]
 * @api public
 */

Bot.prototype.commit = function(repo, msg, fn){
  debug('commit %s "%s"', repo, msg);
  var cmds = [];
  cmds.push('cd ?/?');
  cmds.push('git commit -a -m "' + msg + '"');
  cmds.push('git push origin master');
  var cmd = command(cmds.join(' && '), this.clonePath, repo);
  debug('exec `%s`', cmd);
  exec(cmd, fn || noop);
};

/**
 * Clone `repo` to the `/tmp` directory and invoke `fn(err, path)`.
 *
 *    bot.clone('visionmedia/superagent', fn);
 *
 * @param {String} repo
 * @param {Function} fn
 * @api public
 */

Bot.prototype.clone = function(repo, fn){
  debug('clone %s', repo);
  var path = this.clonePath + '/' + repo;
  var auth = this.user + ':' + this.pass;
  var url = 'https://' + auth + '@github.com/' + repo + '.git';
  var cmd = command('rm -fr ? && git clone ? --depth 1 ?', path, url, path);

  debug('exec `%s`', cmd);
  exec(cmd, function(err){
    if (err) return fn(err);
    fn(null, path);
  });
};

/**
 * Fork `repo`, poll, and invoke `fn(err)`.
 *
 * @param {String} repo
 * @param {Function} fn
 * @api public
 */

Bot.prototype.fork = function(repo, fn){
  var self = this;
  debug('fork %s', repo);

  this.post('/repos/' + repo + '/forks')
  .send({})
  .end(function(res){
    if (res.error) return fn(error(res));

    function poll() {
      debug('poll %s', repo);
      setTimeout(function(){
        self.hasForked(repo, function(err, yes){
          if (err) return fn(err);
          if (yes) return fn();
          poll();
        });
      }, 500);
    }

    poll();
  });
};

/**
 * Fetch an array of all components and invoke `fn(err, pkgs)`
 *
 * @param {Function} fn
 * @api public
 */

Bot.prototype.components = function(fn){
  request
  .get('http://component.io/components/all')
  .end(function(res){
    if (res.error) return fn(error(res));
    fn(null, res.body);
  })
};

/**
 * Send pull-request to `repo` with the given `title` and `body`.
 *
 * @param {String} repo
 * @param {String} title
 * @param {String} body
 * @return {Request}
 * @api public
 */

Bot.prototype.pullrequest = function(repo, title, body, options){
  options = options || {};
  options.title = title;
  options.body = body;
  options.base = 'master';
  options.head = this.user + ':master';
  return this.post('/repos/' + repo + '/pulls')
    .send(options);
};

/**
 * DELETE `path`.
 *
 * @param {String} path
 * @return {Request}
 * @api private
 */

Bot.prototype.del = function(path){
  return request
    .del('https://api.github.com' + path)
    .auth(this.user, this.pass)
    .send({});
};

/**
 * GET `path`.
 *
 * @param {String} path
 * @return {Request}
 * @api private
 */

Bot.prototype.get = function(path){
  return request
    .get('https://api.github.com' + path)
    .auth(this.user, this.pass);
};

/**
 * POST to `path`.
 *
 * @param {String} path
 * @return {Request}
 * @api private
 */

Bot.prototype.post = function(path){
  return request
    .post('https://api.github.com' + path)
    .auth(this.user, this.pass)
};
