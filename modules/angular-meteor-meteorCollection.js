'use strict';

var angularMeteorCollections = angular.module('angular-meteor.meteor-collection',
  ['angular-meteor.subscribe', 'angular-meteor.utils', 'diffArray']);

angularMeteorCollections.factory('AngularMeteorCollection', ['$q', '$meteorSubscribe', '$meteorUtils', '$rootScope', 'diffArray',
  function($q, $meteorSubscribe, $meteorUtils, $rootScope, diffArray) {
    var AngularMeteorCollection = function (cursor, auto) {
      this.$$collection = $meteorUtils.getCollectionByName(cursor.collection.name);
      this.$$auto = auto;
    };

    AngularMeteorCollection.prototype = Array.prototype;

    AngularMeteorCollection.prototype.subscribe = function () {
      $meteorSubscribe.subscribe.apply(this, arguments);
      return this;
    };

    AngularMeteorCollection.prototype.save = function save(docs, useUnsetModifier) {
      var self = this,
        collection = self.$$collection,
        promises = []; // To store all promises.

      /*
       * The upsertObject function will either update an object if the _id exists
       * or insert an object if the _id is not set in the collection.
       * Returns a promise.
       */
      function upsertObject(item) {
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
            this.push(upsertObject(doc));
          }, promises);
        } else { // If a single object was passed.
          promises.push(upsertObject(docs));
        }
      } else { // If no 'docs' argument was passed, save the entire collection.
        angular.forEach(self, function (doc) {
          this.push(upsertObject(doc));
        }, promises);
      }

      return $q.all(promises); // Returns all promises when they're resolved.
    };

    AngularMeteorCollection.prototype.remove = function remove(keys) {
      var self = this,
        collection = self.$$collection,
        promises = []; // To store all promises.

      /*
       * The removeObject function will delete an object with the _id property
       * equal to the specified key.
       * Returns a promise.
       */
      function removeObject(key) {
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
            this.push(removeObject(key));
          }, promises);
        } else { // If a single key was passed.
          promises.push(removeObject(keys));
        }
      } else { // If no 'keys' argument was passed, save the entire collection.
        // When removing all, we do not use collection.remove({}) because Meteor doesn't give the client side that permissions
        // http://stackoverflow.com/a/15465286/1426570
        var originalSelf = angular.copy(self);
        angular.forEach(originalSelf, function (doc) {
          this.push(removeObject(doc._id));
        }, promises);
      }

      return $q.all(promises); // Returns all promises when they're resolved.
    };

    AngularMeteorCollection.prototype.updateDataFromCursor = function (cursor) {
      var self = this;

      // XXX - consider adding an option for a non-orderd result
      // for faster performance
      if (self.observeHandle) {
        self.observeHandle.stop();
      }

      var initialLoad = true;

      function safeApply() {
        if (!initialLoad) {
          // Clearing the watch is needed so no updates are sent to server
          // while handling updates from the server and for performance
          if (self.unregisterAutoBind)
            self.unregisterAutoBind();
          if (!$rootScope.$$phase) $rootScope.$apply();
          // Making sure we are setting to false only after one digest cycle and not before
          self.setAutoBind();
        }
      }

      self.observeHandle = cursor.observeChanges({
        addedBefore: function (id, fields, before) {
          var newItem = self.$$collection.findOne(id);
          if (before == null) {
            self.push(newItem);
          }
          else {
            var beforeIndex = _.indexOf(self, _.findWhere(self, { _id: before}));
            self.splice(beforeIndex, 0, newItem);
          }
          safeApply();
        },
        changed: function (id, fields) {
          angular.extend(_.findWhere(self, {_id: id}), fields);
          safeApply();
        },
        movedBefore: function (id, before) {
          var index = self.indexOf(_.findWhere(self, {_id: id}));
          var removed = self.splice(index, 1)[0];
          if (before == null) {
            self.push(removed);
          }
          else {
            var beforeIndex = _.indexOf(self, _.findWhere(self, { _id: before}));
            self.splice(beforeIndex, 0, removed);
          }
          safeApply();
        },
        removed: function (id) {
          var removedObject;
          if (id._str){
            removedObject = _.find(self, function(obj) {
              return obj._id._str == id._str;
            });
          }
          else
            removedObject = _.findWhere(self, {_id: id});

          if (removedObject){
            self.splice(self.indexOf(removedObject), 1);
            safeApply();
          }
        }
      });

      initialLoad = false;
      safeApply();
    };

    AngularMeteorCollection.prototype.stop = function () {
      if (this.unregisterAutoBind)
        this.unregisterAutoBind();

      this.observeHandle.stop();
      while (this.length > 0) {
        this.pop();
      }
    };

    AngularMeteorCollection.prototype.setAutoBind = function () {
      var self = this;
      if (self.$$auto && !self.unregisterAutoBind) { // Deep watches the model and performs autobind.
        self.unregisterAutoBind = $rootScope.$watch(function () {
          return _.without(self, '$$collection');
        }, function (newItems, oldItems) {
          if (newItems !== oldItems) {

            diffArray(oldItems, newItems, {
              addedAt: function (id, item, index) {
                var newValue = self.splice(index, 1)[0];
                self.save(newValue);
              },
              removedAt: function (id) {
                self.remove(id);
              },
              changedAt: function (id, setDiff, unsetDiff) {
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
    };

  return AngularMeteorCollection;
}]);

angularMeteorCollections.factory('$meteorCollection', ['AngularMeteorCollection',
  function (AngularMeteorCollection) {
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

      var ngCollection = new AngularMeteorCollection(reactiveFunc(), auto);

      /**
       * Update the data from the cursor reactively
       */
      Tracker.autorun(function () {
        // When the reactive func gets recomputated we need to stop any previous
        // observeChanges
        Tracker.onInvalidate(function () {
          ngCollection.stop();
        });
        ngCollection.updateDataFromCursor(reactiveFunc());
        ngCollection.setAutoBind();
      });

      return ngCollection;
    }
  }]);
