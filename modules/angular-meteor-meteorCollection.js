'use strict';

var angularMeteorCollections = angular.module('angular-meteor.meteor-collection',
  ['angular-meteor.subscribe', 'angular-meteor.utils', 'diffArray']);


var AngularMeteorCollection = function (cursor, auto, $q, $meteorSubscribe, $meteorUtils, $rootScope, $timeout, diffArray) {

  var self = [];

  self.__proto__ = AngularMeteorCollection.prototype;
  self.__proto__.$q = $q;
  self.__proto__.$meteorSubscribe = $meteorSubscribe;
  self.__proto__.$rootScope = $rootScope;
  self.__proto__.$timeout = $timeout;
  self.__proto__.diffArray = diffArray;

  self.$$collection = $meteorUtils.getCollectionByName(cursor.collection.name);
  self.$$auto = auto;

  return self;
};

AngularMeteorCollection.prototype = [];

AngularMeteorCollection.prototype.subscribe = function () {
  var self = this;
  self.$meteorSubscribe.subscribe.apply(this, arguments);
  return this;
};

AngularMeteorCollection.prototype.save = function save(docs, useUnsetModifier) {
  var self = this,
    collection = self.$$collection,
    $q = self.$q,
    promises = []; // To store all promises.

  /*
   * The upsertObject function will either update an object if the _id exists
   * or insert an object if the _id is not set in the collection.
   * Returns a promise.
   */
  function upsertObject(item, $q) {
    var deferred = $q.defer();

    item = angular.copy(item);

    if (item._id) { // Performs an update if the _id property is set.
      var item_id = item._id; // Store the _id in temporary variable
      delete item._id; // Remove the _id property so that it can be $set using update.
      var objectId = (item_id._str) ? new Meteor.Collection.ObjectID(item_id._str) : item_id;
      var modifier = (useUnsetModifier) ? {$unset: item} : {$set: item};

      collection.update(objectId, modifier, function (error) {
        if (error) {
          deferred.reject(error);
        } else {
          deferred.resolve({_id: objectId, action: "updated"});
        }
      });
    } else { // Performs an insert if the _id property isn't set.
      collection.insert(item, function (error, result) {
        if (error) {
          deferred.reject(error);
        } else {
          deferred.resolve({_id: result, action: "inserted"});
        }
      });
    }

    return deferred.promise;
  }

  /*
   * How to update the collection depending on the 'docs' argument passed.
   */
  if (docs) { // Checks if a 'docs' argument was passed.
    if (angular.isArray(docs)) { // If an array of objects were passed.
      angular.forEach(docs, function (doc) {
        this.push(upsertObject(doc, $q));
      }, promises);
    } else { // If a single object was passed.
      promises.push(upsertObject(docs, $q));
    }
  } else { // If no 'docs' argument was passed, save the entire collection.
    angular.forEach(self, function (doc) {
      this.push(upsertObject(doc, $q));
    }, promises);
  }

  return $q.all(promises); // Returns all promises when they're resolved.
};

AngularMeteorCollection.prototype.remove = function remove(keys) {
  var self = this,
    collection = self.$$collection,
    $q = self.$q,
    promises = []; // To store all promises.

  /*
   * The removeObject function will delete an object with the _id property
   * equal to the specified key.
   * Returns a promise.
   */
  function removeObject(key, $q) {
    var deferred = $q.defer();

    if (key) { // Checks if 'key' argument is set.
      if (key._id) {
        key = key._id;
      }
      var objectId = (key._str) ? new Meteor.Collection.ObjectID(key._str) : key;

      collection.remove(objectId, function (error) {
        if (error) {
          deferred.reject(error);
        } else {
          deferred.resolve({_id: objectId, action: "removed"});
        }
      });
    } else {
      deferred.reject("key cannot be null");
    }

    return deferred.promise;
  }

  /*
   * What to remove from collection depending on the 'keys' argument passed.
   */
  if (keys) { // Checks if a 'keys' argument was passed.
    if (angular.isArray(keys)) { // If an array of keys were passed.
      angular.forEach(keys, function (key) {
        this.push(removeObject(key, $q));
      }, promises);
    } else { // If a single key was passed.
      promises.push(removeObject(keys, $q));
    }
  } else { // If no 'keys' argument was passed, save the entire collection.
    // When removing all, we do not use collection.remove({}) because Meteor doesn't give the client side that permissions
    // http://stackoverflow.com/a/15465286/1426570
    var originalSelf = angular.copy(self);
    angular.forEach(originalSelf, function (doc) {
      this.push(removeObject(doc._id, $q));
    }, promises);
  }

  return $q.all(promises); // Returns all promises when they're resolved.
};

AngularMeteorCollection.prototype.updateCursor = function (cursor) {
  var self = this,
    $rootScope = self.$rootScope,
    $timeout = self.$timeout;

  function safeApply() {
    // Clearing the watch is needed so no updates are sent to server
    // while handling updates from the server
    if (self.unregisterAutoBind){
      self.unregisterAutoBind();
      console.log('stopping in safeapply');
    }


    console.log('undefning in safeapply');
    self.unregisterAutoBind = undefined;
    self.UPDATING_FROM_SERVER = true;
    if (!$rootScope.$$phase) $rootScope.$apply();
    // Making sure we are setting to false only after one digest cycle and not before
    $timeout(function(){
      self.UPDATING_FROM_SERVER = false;
      self.setAutoBind();
    },0,false);
  }

  // XXX - consider adding an option for a non-orderd result
  // for faster performance
  if (self.observeHandle) {
    self.observeHandle.stop();
  }

  self.observeHandle = cursor.observe({
    addedAt: function (document, atIndex) {
      self.splice(atIndex, 0, document);
      safeApply();
    },
    changed: function (document, oldDocument, atIndex) {
      self.splice(atIndex, 1, document);
      safeApply();
    },
    movedTo: function (document, fromIndex, toIndex) {
      self.splice(fromIndex, 1);
      self.splice(toIndex, 0, document);
      safeApply();
    },
    removedAt: function (oldDocument, atIndex) {
      self.splice(atIndex, 1);
      safeApply();
    }
  });
};

AngularMeteorCollection.prototype.stop = function () {
  console.log('stopping in stop');
  if (this.unregisterAutoBind)
    this.unregisterAutoBind();

  this.observeHandle.stop();
  while (this.length > 0) {
    this.pop();
  }
};

AngularMeteorCollection.prototype.setAutoBind = function() {
  var self = this,
    diffArray = self.diffArray;

  //console.log('(self.unregisterAutoBind == undefined)', (self.unregisterAutoBind == undefined));

  console.log('outside', self.unregisterAutoBind);
  if (!self.unregisterAutoBind) {
    console.log('inside');
    if (self.$$auto) { // Deep watches the model and performs autobind.
      console.log('definind');
      self.unregisterAutoBind = self.$rootScope.$watch(function () {
        return _.without(self, 'UPDATING_FROM_SERVER');
      }, function (newItems, oldItems) {
        console.log('watch called', self.UPDATING_FROM_SERVER);
        console.log('watch called', newItems !== oldItems);
        console.log('watch called new', newItems);
        console.log('watch called old', oldItems);
        if (!self.UPDATING_FROM_SERVER && newItems !== oldItems) {

          console.log('watch called inside');
          diffArray(angular.copy(oldItems), angular.copy(newItems), {
            addedAt: function (id, item, index) {
              console.log('added');
              var newValue = angular.copy(self[index]);
              if (self.unregisterAutoBind){
                self.unregisterAutoBind();
                self.splice( index, 1 );
                self.setAutoBind();
              } else {
                self.splice( index, 1 );
              }
              self.save(newValue);
            },
            removedAt: function (id, item, index) {
              self.remove(id);
            },
            changedAt: function (id, setDiff, unsetDiff, index) {
              if (setDiff)
                self.save(setDiff);

              if (unsetDiff)
                self.save(unsetDiff, true);
            },
            movedTo: function (id, item, fromIndex, toIndex) {
              // XXX do we need this?
            }
          });
        }
      }, true);
    }
  }
};

  angularMeteorCollections.factory('$meteorCollection', ['$q', '$meteorSubscribe', '$meteorUtils', '$rootScope', '$timeout', 'diffArray',
  function ($q, $meteorSubscribe, $meteorUtils, $rootScope, $timeout, diffArray) {
    return function (reactiveFunc, auto) {
      // Validate parameters
      if (!reactiveFunc) {
        throw new TypeError("The first argument of $meteorCollection is undefined.");
      }
      if (!(typeof reactiveFunc == "function" || reactiveFunc instanceof Mongo.Collection)) {
        throw new TypeError("The first argument of $meteorCollection must be a function or a Mongo.Collection.");
      }
      auto = auto !== false;

      if (reactiveFunc instanceof Mongo.Collection) {
        var collection = reactiveFunc;
        reactiveFunc = function() {
          return collection.find({});
        }
      }

      var ngCollection = new AngularMeteorCollection(reactiveFunc(), auto, $q, $meteorSubscribe, $meteorUtils, $rootScope, $timeout, diffArray);

      /**
       * Fetches the latest data from Meteor and update the data variable.
       */
      Tracker.autorun(function () {
        // When the reactive func gets recomputated we need to stop any previous
        // observeChanges
        Tracker.onInvalidate(function () {
          ngCollection.stop();
        });
        ngCollection.updateCursor(reactiveFunc());
        ngCollection.setAutoBind();
      });

      return ngCollection;
    }
  }]);
