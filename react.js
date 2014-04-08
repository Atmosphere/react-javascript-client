/*
 * React v3.0.0-Alpha1
 * http://atmosphere.github.io/react/
 * 
 * Copyright 2011-2014, Donghwan Kim 
 * Licensed under the Apache License, Version 2.0
 * http://www.apache.org/licenses/LICENSE-2.0
 */

// Implement the Universal Module Definition (UMD) pattern 
// see https://github.com/umdjs/umd/blob/master/returnExports.js
(function(root, factory) {
    if (typeof define === "function" && define.amd) {
        // AMD
        define([], function() {
            return factory(root);
        });
    } else if (typeof exports === "object") {
        // Node
        module.exports = factory((function() {
            // Prepare the window powered by jsdom
            var window = require("jsdom").jsdom().createWindow();
            window.WebSocket = require("ws");
            window.EventSource = require("eventsource");
            return window;
        })());
        // node-XMLHttpRequest 1.x conforms XMLHttpRequest Level 1 but can perform a cross-domain request
        module.exports.support.corsable = true;
    } else {
        // Browser globals, Window
        root.react = factory(root);
    }
}(this, function(window) {
    
    // Enables ECMAScript 5′s strict mode
    "use strict";
    
    var // A global identifier
        guid,
        // Is the unload event being processed?
        unloading,
        // React
        react,
        // Convenience utilities
        support,
        // Default options
        defaults,
        // Transports
        transports,
        // Socket instances
        sockets = {},
        // Callback names for JSONP
        jsonpCallbacks = [],
        // Core prototypes
        toString = Object.prototype.toString,
        hasOwn = Object.prototype.hasOwnProperty,
        slice = Array.prototype.slice,
        // Regard for Node since these are not defined
        document = window.document,
        location = window.location;
    
    // Callback function
    function callbacks(deferred) {
        var locked,
            memory,
            firing,
            firingStart,
            firingLength,
            firingIndex,
            list = [],
            fire = function(context, args) {
                args = args || [];
                memory = !deferred || [context, args];
                firing = true;
                firingIndex = firingStart || 0;
                firingStart = 0;
                firingLength = list.length;
                for (; firingIndex < firingLength && !locked; firingIndex++) {
                    list[firingIndex].apply(context, args);
                }
                firing = false;
            },
            self = {
                add: function(fn) {
                    var length = list.length;
                    
                    list.push(fn);
                    if (firing) {
                        firingLength = list.length;
                    } else if (!locked && memory && memory !== true) {
                        firingStart = length;
                        fire(memory[0], memory[1]);
                    }
                },
                remove: function(fn) {
                    var i;
                    
                    for (i = 0; i < list.length; i++) {
                        if (fn === list[i] || (fn.guid && fn.guid === list[i].guid)) {
                            if (firing) {
                                if (i <= firingLength) {
                                    firingLength--;
                                    if (i <= firingIndex) {
                                        firingIndex--;
                                    }
                                }
                            }
                            list.splice(i--, 1);
                        }
                    }
                },
                fire: function(context, args) {
                    if (!locked && !firing && !(deferred && memory)) {
                        fire(context, args);
                    }
                },
                lock: function() {
                    locked = true;
                },
                locked: function() {
                    return !!locked;
                },
                unlock: function() {
                    locked = memory = firing = firingStart = firingLength = firingIndex = undefined;
                }
            };
        
        return self;
    }
    
    // Socket function
    function socket(url, options) {
        var // Final options
            opts,
            // Transport
            transport,
            isSessionTransport,
            // The state of the connection
            state,
            // Reconnection
            reconnectTimer,
            reconnectDelay,
            reconnectTry,
            // Event helpers
            events = {},
            eventId = 0,
            // Reply callbacks
            replyCallbacks = {},
            // To check cross-origin
            parts = /^([\w\+\.\-]+:)(?:\/\/([^\/?#:]*)(?::(\d+))?)?/.exec(url.toLowerCase()),
            // Socket object
            self = {
                // Returns the state
                state: function() {
                    return state;
                },
                // Adds event handler
                on: function(type, fn) {
                    var event;
                    
                    // Handles a map of type and handler
                    if (typeof type === "object") {
                        for (event in type) {
                            self.on(event, type[event]);
                        }
                        return this;
                    }
                    
                    // For custom event
                    event = events[type];
                    if (!event) {
                        if (events.message.locked()) {
                            return this;
                        }
                        
                        event = events[type] = callbacks();
                        event.order = events.message.order;
                    }
                    
                    event.add(fn);
                    
                    return this;
                },
                // Removes event handler
                off: function(type, fn) {
                    var event = events[type];
                    
                    if (event) {
                        event.remove(fn);
                    }
                    
                    return this;
                },
                // Adds one time event handler
                one: function(type, fn) {
                    function proxy() {
                        self.off(type, proxy);
                        fn.apply(self, arguments);
                    }
                    
                    fn.guid = fn.guid || guid++;
                    proxy.guid = fn.guid;
                    
                    return self.on(type, proxy);
                },
                // Fires event handlers
                fire: function(type) {
                    var event = events[type];
                    
                    if (event) {
                        event.fire(self, slice.call(arguments, 1));
                    }
                    
                    return this;
                },
                // Establishes a connection
                open: function() {
                    var type, candidates;
                    
                    // Cancels the scheduled connection
                    clearTimeout(reconnectTimer);
                    // Resets event helpers
                    for (type in events) {
                        events[type].unlock();
                    }
                    // Chooses transport
                    transport = isSessionTransport = null;
                    // From null or waiting state
                    state = "preparing";
                    
                    candidates = slice.call(opts.transports);
                    // Check if possible to make use of a shared socket
                    if (opts.sharing) {
                        candidates.unshift("session");
                    }
                    while (!transport && candidates.length) {
                        type = candidates.shift();
                        switch (type) {
                        case "stream":
                            candidates.unshift("sse", "streamxhr", "streamxdr", "streamiframe");
                            break;
                        case "longpoll":
                            candidates.unshift("longpollajax", "longpollxdr", "longpolljsonp");
                            break;
                        default:
                            // A transport instance will be null if it can't run on this environment
                            transport = transports[type](self, opts);
                            break;
                        }
                    }
                    // Increases the number of reconnection attempts
                    if (reconnectTry) {
                        reconnectTry++;
                    }
                    // Fires the connecting event and connects
                    if (transport) {
                        opts.transport = type;
                        isSessionTransport = type === "session";
                        self.fire("connecting");
                        transport.open();
                    } else {
                        self.fire("close", "notransport");
                    }
                    return this;
                },
                // Sends an event to the server via the connection
                send: function(type, data, onResolved, onRejected) {
                    if (state !== "opened") {
                        throw new Error("A socket is not open yet");
                    }
                    
                    // Outbound event
                    var event = {id: ++eventId, type: type, data: data, reply: !!(onResolved || onRejected)};
                    if (event.reply) {
                        // Shared socket needs to know the callback event name
                        // because it fires the callback event directly instead of using reply event
                        if (isSessionTransport) {
                            event.onResolved = onResolved;
                            event.onRejected = onRejected;
                        } else {
                            replyCallbacks[eventId] = [onRejected, onResolved];
                        }
                    }
                    // Delegates to the transport
                    transport.send(support.stringifyJSON(event));
                    return this;
                },
                // Disconnects the connection
                close: function() {
                    // Prevents reconnection
                    opts.reconnect = false;
                    clearTimeout(reconnectTimer);
                    // Delegates to the transport
                    if (transport) {
                        transport.close();
                    }
                    return this;
                },
                // For internal use only
                // receives an event from the server via the connection
                receive: function(data) {
                    var latch, 
                        // Inbound event
                        event = support.parseJSON(data), 
                        args = [event.type, event.data, !event.reply ? null : {
                            resolve: function(value) {
                                if (!latch) {
                                    latch = true;
                                    self.send("reply", {id: event.id, data: value, exception: false});
                                }
                            },
                            reject: function(reason) {
                                if (!latch) {
                                    latch = true;
                                    self.send("reply", {id: event.id, data: reason, exception: true});
                                }
                            }
                        }];
                    
                    return self.fire.apply(self, args).fire("_message", args);
                }
            };
        
        // Create the final options
        opts = support.extend({}, defaults, options);
        if (options) {
            // Array should not be deep extended
            if (options.transports) {
                opts.transports = slice.call(options.transports);
            }
        }
        // Saves original URL
        opts.url = url;
        // Generates socket id,
        opts.id = support.uuid();
        opts.crossDomain = !!(parts &&
            // protocol and hostname
            (parts[1] != location.protocol || parts[2] != location.hostname ||
            // port
            (parts[3] || (parts[1] === "http:" ? 80 : 443)) != (location.port || (location.protocol === "http:" ? 80 : 443))));
        
        support.each(["connecting", "open", "message", "close", "waiting"], function(i, type) {
            // Creates event helper
            events[type] = callbacks(type !== "message");
            events[type].order = i;
            
            // Shortcuts for on method
            var old = self[type],
                on = function(fn) {
                    return self.on(type, fn);
                };
            
            self[type] = !old ? on : function(fn) {
                return (support.isFunction(fn) ? on : old).apply(this, arguments);
            };
        });
        
        // Initializes
        self.on({
            connecting: function() {
                // From preparing state
                state = "connecting";
                
                var timeoutTimer;
                
                // Sets timeout timer
                function setTimeoutTimer() {
                    timeoutTimer = setTimeout(function() {
                        transport.close();
                        self.fire("close", "timeout");
                    }, opts.timeout);
                }
                
                // Clears timeout timer
                function clearTimeoutTimer() {
                    clearTimeout(timeoutTimer);
                }
                
                // Makes the socket sharable
                function share() {
                    var traceTimer,
                        server,
                        name = "socket-" + url,
                        servers = {
                            // Powered by the storage event and the localStorage
                            // http://www.w3.org/TR/webstorage/#event-storage
                            storage: function() {
                                // The storage event of Internet Explorer works strangely
                                // TODO test Internet Explorer 11
                                if (support.browser.msie) {
                                    return;
                                }
                                
                                var storage = window.localStorage;
                                
                                return {
                                    init: function() {
                                        function onstorage(event) {
                                            // When a deletion, newValue initialized to null
                                            if (event.key === name && event.newValue) {
                                                listener(event.newValue);
                                            }
                                        }
                                        
                                        // Handles the storage event
                                        support.on(window, "storage", onstorage);
                                        self.one("close", function() {
                                            support.off(window, "storage", onstorage);
                                            // Defers again to clean the storage
                                            self.one("close", function() {
                                                storage.removeItem(name);
                                                storage.removeItem(name + "-opened");
                                                storage.removeItem(name + "-children");
                                            });
                                        });
                                    },
                                    broadcast: function(obj) {
                                        var string = support.stringifyJSON(obj);
                                        storage.setItem(name, string);
                                        setTimeout(function() {
                                            listener(string);
                                        }, 50);
                                    },
                                    get: function(key) {
                                        return support.parseJSON(storage.getItem(name + "-" + key));
                                    },
                                    set: function(key, value) {
                                        storage.setItem(name + "-" + key, support.stringifyJSON(value));
                                    }
                                };
                            },
                            // Powered by the window.open method
                            // https://developer.mozilla.org/en/DOM/window.open
                            windowref: function() {
                                // Internet Explorer raises an invalid argument error
                                // when calling the window.open method with the name containing non-word characters
                                var neim = name.replace(/\W/g, ""),
                                    container = document.getElementById(neim),
                                    win;
                                
                                if (!container) {
                                    container = document.createElement("div");
                                    container.id = neim;
                                    container.style.display = "none";
                                    container.innerHTML = '<iframe name="' + neim + '" />';
                                    document.body.appendChild(container);
                                }
                                
                                win = container.firstChild.contentWindow;
                                
                                return {
                                    init: function() {
                                        // Callbacks from different windows
                                        win.callbacks = [listener];
                                        // In Internet Explorer 8 and less, only string argument can be safely passed to the function in other window
                                        win.fire = function(string) {
                                            var i;
                                            
                                            for (i = 0; i < win.callbacks.length; i++) {
                                                win.callbacks[i](string);
                                            }
                                        };
                                    },
                                    broadcast: function(obj) {
                                        if (!win.closed && win.fire) {
                                            win.fire(support.stringifyJSON(obj));
                                        }
                                    },
                                    get: function(key) {
                                        return !win.closed ? win[key] : null;
                                    },
                                    set: function(key, value) {
                                        if (!win.closed) {
                                            win[key] = value;
                                        }
                                    }
                                };
                            }
                        };
                    
                    // Receives send and close command from the children
                    function listener(string) {
                        var command = support.parseJSON(string), data = command.data;
                        
                        if (!command.target) {
                            if (command.type === "fire") {
                                self.fire(data.type, data.data);
                            }
                        } else if (command.target === "p") {
                            switch (command.type) {
                            case "send":
                                self.send(data.type, data.data, data.onResolved, data.onRejected);
                                break;
                            case "close":
                                self.close();
                                break;
                            }
                        }
                    }
                    
                    function propagateMessageEvent(args) {
                        server.broadcast({target: "c", type: "message", data: args});
                    }
                    
                    function leaveTrace() {
                        document.cookie = encodeURIComponent(name) + "=" +
                            encodeURIComponent(support.stringifyJSON({ts: support.now(), heir: (server.get("children") || [])[0]})) +
                            "; path=/";
                    }
                    
                    // Chooses a server
                    server = servers.storage() || servers.windowref();
                    server.init();
                    
                    // List of children sockets
                    server.set("children", []);
                    // Flag indicating the parent socket is opened
                    server.set("opened", false);
                    
                    // Leaves traces
                    leaveTrace();
                    traceTimer = setInterval(leaveTrace, 1000);
                    
                    self.on("_message", propagateMessageEvent)
                    .one("open", function() {
                        server.set("opened", true);
                        server.broadcast({target: "c", type: "open"});
                    })
                    .one("close", function(reason) {
                        // Clears trace timer
                        clearInterval(traceTimer);
                        // Removes the trace
                        document.cookie = encodeURIComponent(name) + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
                        // The heir is the parent unless unloading
                        server.broadcast({target: "c", type: "close", data: {reason: reason, heir: !unloading ? opts.id : (server.get("children") || [])[0]}});
                        self.off("_message", propagateMessageEvent);
                    });
                }
                
                if (opts.timeout > 0) {
                    setTimeoutTimer();
                    self.one("open", clearTimeoutTimer).one("close", clearTimeoutTimer);
                }
                
                // Share the socket if possible
                if (opts.sharing && !isSessionTransport) {
                    share();
                }
            },
            open: function() {
                // From connecting state
                state = "opened";
                
                var heartbeatTimer;
                
                // Sets heartbeat timer
                function setHeartbeatTimer() {
                    heartbeatTimer = setTimeout(function() {
                        self.send("heartbeat").one("heartbeat", function() {
                            clearHeartbeatTimer();
                            setHeartbeatTimer();
                        });
                        
                        heartbeatTimer = setTimeout(function() {
                            transport.close();
                            self.fire("close", "error");
                        }, opts._heartbeat);
                    }, opts.heartbeat - opts._heartbeat);
                }
                
                // Clears heartbeat timer
                function clearHeartbeatTimer() {
                    clearTimeout(heartbeatTimer);
                }
                
                if (opts.heartbeat > opts._heartbeat) {
                    setHeartbeatTimer();
                    self.one("close", clearHeartbeatTimer);
                }
                
                // Locks the connecting event
                events.connecting.lock();
                
                // Initializes variables related with reconnection
                reconnectTimer = reconnectDelay = reconnectTry = null;
            },
            close: function() {
                // From preparing, connecting, or opened state
                state = "closed";
                
                var type, event, order = events.close.order;
                
                // Locks event whose order is lower than close event
                for (type in events) {
                    event = events[type];
                    if (event.order < order) {
                        event.lock();
                    }
                }
                
                // Schedules reconnection
                if (opts.reconnect) {
                    self.one("close", function() {
                        reconnectTry = reconnectTry || 1;
                        reconnectDelay = opts.reconnect.call(self, reconnectDelay, reconnectTry);
                        
                        if (reconnectDelay !== false) {
                            reconnectTimer = setTimeout(function() {
                                self.open();
                            }, reconnectDelay);
                            self.fire("waiting", reconnectDelay, reconnectTry);
                        }
                    });
                }
            },
            waiting: function() {
                // From closed state
                state = "waiting";
            },
            reply: function(reply) {
                var fn,
                    id = reply.id,
                    data = reply.data,
                    callback = replyCallbacks[id];
                
                if (callback) {
                    // callback is [onRejected, onResolved] and +false and + true is 0 and 1, respectively
                    fn = callback[+reply.exception];
                    if (fn) {
                        if (support.isFunction(fn)) {
                            fn.call(self, data);
                        } else {
                            self.fire(fn, data).fire("_message", [fn, data]);
                        }
                    }
                    delete replyCallbacks[id];
                }
            }
        });
        
        return self.open();
    }
        
    // Defines the react
    react = {
        // Creates a new socket and connects to the given url
        open: function(url, options) {
            // Makes url absolute to normalize URL
            url = support.getAbsoluteURL(url);
            return sockets[url] = socket(url, options);
        }
    };
    
    // Most utility functions are borrowed from jQuery
    react.support = support = {
        now: function() {
            return new Date().getTime();
        },
        isArray: function(array) {
            return toString.call(array) === "[object Array]";
        },
        isFunction: function(fn) {
            return toString.call(fn) === "[object Function]";
        },
        getAbsoluteURL: function(url) {
            var div = document.createElement("div");
            
            // Uses an innerHTML property to obtain an absolute URL
            div.innerHTML = '<a href="' + url + '"/>';
            
            // encodeURI and decodeURI are needed to normalize URL between Internet Explorer and non-Internet Explorer,
            // since Internet Explorer doesn't encode the href property value and return it - http://jsfiddle.net/Yq9M8/1/
            return encodeURI(decodeURI(div.firstChild.href));
        },
        each: function(array, callback) {
            var i;
            
            for (i = 0; i < array.length; i++) {
                callback(i, array[i]);
            }
        },
        extend: function(target) {
            var i, options, name;
            
            for (i = 1; i < arguments.length; i++) {
                if ((options = arguments[i]) != null) {
                    for (name in options) {
                        target[name] = options[name];
                    }
                }
            }
            
            return target;
        },
        on: function(elem, type, fn) {
            if (elem.addEventListener) {
                elem.addEventListener(type, fn, false);
            } else if (elem.attachEvent) {
                elem.attachEvent("on" + type, fn);
            }
        },
        off: function(elem, type, fn) {
            if (elem.removeEventListener) {
                elem.removeEventListener(type, fn, false);
            } else if (elem.detachEvent) {
                elem.detachEvent("on" + type, fn);
            }
        },
        param: function(params) {
            var prefix, s = [];
            
            function add(key, value) {
                value = support.isFunction(value) ? value() : (value == null ? "" : value);
                s.push(encodeURIComponent(key) + "=" + encodeURIComponent(value));
            }
            
            function buildParams(prefix, obj) {
                var name;
                
                if (support.isArray(obj)) {
                    support.each(obj, function(i, v) {
                        if (/\[\]$/.test(prefix)) {
                            add(prefix, v);
                        } else {
                            buildParams(prefix + "[" + (typeof v === "object" ? i : "") + "]", v);
                        }
                    });
                } else if (obj != null && toString.call(obj) === "[object Object]") {
                    for (name in obj) {
                        buildParams(prefix + "[" + name + "]", obj[name]);
                    }
                } else {
                    add(prefix, obj);
                }
            }
            
            for (prefix in params) {
                buildParams(prefix, params[prefix]);
            }
            
            return s.join("&").replace(/%20/g, "+");
        },
        url: function(url, params) {
            params = params || {};
            params._ = guid++;
            return url + (/\?/.test(url) ? "&" : "?") + support.param(params);
        },
        xhr: function() {
            try {
                return new window.XMLHttpRequest();
            } catch (e1) {
                try {
                    return new window.ActiveXObject("Microsoft.XMLHTTP");
                } catch (e2) {}
            }
        },
        parseJSON: function(data) {
            return !data ?
                null :
                window.JSON && window.JSON.parse ?
                    window.JSON.parse(data) :
                    Function("return " + data)();
        },
        // http://github.com/flowersinthesand/stringifyJSON
        stringifyJSON: function(value) {
            var escapable = /[\\\"\x00-\x1f\x7f-\x9f\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g,
                meta = {
                    '\b': '\\b',
                    '\t': '\\t',
                    '\n': '\\n',
                    '\f': '\\f',
                    '\r': '\\r',
                    '"': '\\"',
                    '\\': '\\\\'
                };
            
            function quote(string) {
                return '"' + string.replace(escapable, function(a) {
                    var c = meta[a];
                    return typeof c === "string" ? c : "\\u" + ("0000" + a.charCodeAt(0).toString(16)).slice(-4);
                }) + '"';
            }
            
            function f(n) {
                return n < 10 ? "0" + n : n;
            }
            
            return window.JSON && window.JSON.stringify ?
                window.JSON.stringify(value) :
                (function str(key, holder) {
                    var i, v, len, partial, value = holder[key], type = typeof value;
                            
                    if (value && typeof value === "object" && typeof value.toJSON === "function") {
                        value = value.toJSON(key);
                        type = typeof value;
                    }
                    
                    switch (type) {
                    case "string":
                        return quote(value);
                    case "number":
                        return isFinite(value) ? String(value) : "null";
                    case "boolean":
                        return String(value);
                    case "object":
                        if (!value) {
                            return "null";
                        }
                        
                        switch (toString.call(value)) {
                        case "[object Date]":
                            return isFinite(value.valueOf()) ?
                                '"' + value.getUTCFullYear() + "-" + f(value.getUTCMonth() + 1) + "-" + f(value.getUTCDate()) +
                                "T" + f(value.getUTCHours()) + ":" + f(value.getUTCMinutes()) + ":" + f(value.getUTCSeconds()) + "Z" + '"' :
                                "null";
                        case "[object Array]":
                            len = value.length;
                            partial = [];
                            for (i = 0; i < len; i++) {
                                partial.push(str(i, value) || "null");
                            }
                            
                            return "[" + partial.join(",") + "]";
                        default:
                            partial = [];
                            for (i in value) {
                                if (hasOwn.call(value, i)) {
                                    v = str(i, value);
                                    if (v) {
                                        partial.push(quote(i) + ":" + v);
                                    }
                                }
                            }
                            
                            return "{" + partial.join(",") + "}";
                        }
                    }
                })("", {"": value});
        },
        uuid: function() {
            // Generates a random UUID
            // Logic borrowed from http://stackoverflow.com/questions/105034/how-to-create-a-guid-uuid-in-javascript/2117523#2117523
            return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
                var r = Math.random() * 16 | 0, v = c === "x" ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
        }
    };
    guid = support.now();
    support.corsable = "withCredentials" in support.xhr();
    support.on(window, "unload", function() {
        unloading = true;
        
        var url, socket;
        for (url in sockets) {
            socket = sockets[url];
        	// Closes a socket as the document is unloaded
            if (socket.state() !== "closed") {
                socket.close();
            }
        }
    });
    support.on(window, "online", function() {
        var url, socket;
        
        for (url in sockets) {
            socket = sockets[url];
            // Opens a socket because of no reason to wait
            if (socket.state() === "waiting") {
                socket.open();
            }
        }
    });
    support.on(window, "offline", function() {
        var url, socket;
        
        for (url in sockets) {
            socket = sockets[url];
            // Fires a close event immediately
            if (socket.state() === "opened") {
                socket.fire("close", "error");
            }
        }
    });
    // Browser sniffing
    (function(ua) {
        var browser = {},
            match =
                // IE 6-10
                /(msie) ([\w.]+)/.exec(ua) ||
                // IE 11+
                /(trident)(?:.*? rv:([\w.]+)|)/.exec(ua) ||
                [];
        
        browser[match[1] || ""] = true;
        browser.version = match[2] || "0";
        
        // Trident is the layout engine of the Internet Explorer
        if (browser.trident) {
            browser.msie = true;
        }
        
        support.browser = browser;
    })(window.navigator.userAgent.toLowerCase());
    
    react.defaults = defaults = {
        transports: ["ws", "stream", "longpoll"],
        timeout: false,
        heartbeat: false,
        _heartbeat: 5000,
        sharing: false,
        reconnect: function(lastDelay) {
            return 2 * (lastDelay || 250);
        }
        // See the fifth at http://blogs.msdn.com/b/ieinternals/archive/2010/05/13/xdomainrequest-restrictions-limitations-and-workarounds.aspx
        // and http://stackoverflow.com/questions/6453779/maintaining-session-by-rewriting-url
        // xdrURL: function(url) {return url_with_credentials}
    };
    
    react.transports = transports = {
        // Session socket for connection sharing
        session: function(socket, options) {
            var trace,
                orphan,
                connector,
                name = "socket-" + options.url,
                connectors = {
                    storage: function() {
                        // The storage event of Internet Explorer works strangely
                        // TODO test Internet Explorer 11
                        if (support.browser.msie) {
                            return;
                        }
                        
                        var storage = window.localStorage;
                        
                        function get(key) {
                            return support.parseJSON(storage.getItem(name + "-" + key));
                        }
                        
                        function set(key, value) {
                            storage.setItem(name + "-" + key, support.stringifyJSON(value));
                        }
                        
                        return {
                            init: function() {
                                function onstorage(event) {
                                    if (event.key === name && event.newValue) {
                                        listener(event.newValue);
                                    }
                                }
                                
                                set("children", get("children").concat([options.id]));
                                support.on(window, "storage", onstorage);
                                
                                socket.one("close", function() {
                                    var children = get("children");
                                    
                                    support.off(window, "storage", onstorage);
                                    if (children) {
                                        if (removeFromArray(children, options.id)) {
                                            set("children", children);
                                        }
                                    }
                                });
                                
                                return get("opened");
                            },
                            broadcast: function(obj) {
                                var string = support.stringifyJSON(obj);
                                
                                storage.setItem(name, string);
                                setTimeout(function() {
                                    listener(string);
                                }, 50);
                            }
                        };
                    },
                    windowref: function() {
                        var win = window.open("", name.replace(/\W/g, ""));
                        
                        if (!win || win.closed || !win.callbacks) {
                            return;
                        }
                        
                        return {
                            init: function() {
                                win.callbacks.push(listener);
                                win.children.push(options.id);
                                
                                socket.one("close", function() {
                                    // Removes traces only if the parent is alive
                                    if (!orphan) {
                                        removeFromArray(win.callbacks, listener);
                                        removeFromArray(win.children, options.id);
                                    }
                                });
                                
                                return win.opened;
                            },
                            broadcast: function(obj) {
                                if (!win.closed && win.fire) {
                                    win.fire(support.stringifyJSON(obj));
                                }
                            }
                        };
                    }
                };
            
            function removeFromArray(array, val) {
                var i,
                    length = array.length;
                
                for (i = 0; i < length; i++) {
                    if (array[i] === val) {
                        array.splice(i, 1);
                    }
                }
                
                return length !== array.length;
            }
            
            // Receives open, close and message command from the parent
            function listener(string) {
                var command = support.parseJSON(string), data = command.data;
                
                if (!command.target) {
                    if (command.type === "fire") {
                        socket.fire(data.type, data.data);
                    }
                } else if (command.target === "c") {
                    switch (command.type) {
                    case "open":
                        socket.fire("open");
                        break;
                    case "close":
                        if (!orphan) {
                            orphan = true;
                            if (data.reason === "aborted") {
                                socket.close();
                            } else {
                                // Gives the heir some time to reconnect
                                if (data.heir === options.id) {
                                    socket.fire("close", data.reason);
                                } else {
                                    setTimeout(function() {
                                        socket.fire("close", data.reason);
                                    }, 100);
                                }
                            }
                        }
                        break;
                    case "message":
                        // When using the session transport, message events could be sent before the open event
                        if (socket.state() === "connecting") {
                            socket.one("open", function() {
                                socket.fire.apply(socket, data);
                            });
                        } else {
                            socket.fire.apply(socket, data);
                        }
                        break;
                    }
                }
            }
            
            function findTrace() {
                var matcher = new RegExp("(?:^|; )(" + encodeURIComponent(name) + ")=([^;]*)").exec(document.cookie);
                if (matcher) {
                    return support.parseJSON(decodeURIComponent(matcher[2]));
                }
            }
            
            // Finds and validates the parent socket's trace from the cookie
            trace = findTrace();
            if (!trace || support.now() - trace.ts > 1000) {
                return;
            }
            
            // Chooses a connector
            connector = connectors.storage() || connectors.windowref();
            if (!connector) {
                return;
            }
            
            return {
                open: function() {
                    var traceTimer,
                        parentOpened,
                        timeout = options.timeout,
                        heartbeat = options.heartbeat;
                    
                    // Prevents side effects
                    options.timeout = options.heartbeat = false;
                    
                    // Checks the shared one is alive
                    traceTimer = setInterval(function() {
                        var oldTrace = trace;
                        
                        trace = findTrace();
                        if (!trace || oldTrace.ts === trace.ts) {
                            // Simulates a close signal
                            listener(support.stringifyJSON({target: "c", type: "close", data: {reason: "error", heir: oldTrace.heir}}));
                        }
                    }, 1000);
                    
                    // Restores options
                    socket.one("close", function() {
                        clearInterval(traceTimer);
                        options.timeout = timeout;
                        options.heartbeat = heartbeat;
                    });
                    
                    parentOpened = connector.init();
                    if (parentOpened) {
                        // Gives the user the opportunity to bind connecting event handlers
                        setTimeout(function() {
                            socket.fire("open");
                        }, 50);
                    }
                },
                send: function(event) {
                    connector.broadcast({target: "p", type: "send", data: event});
                },
                close: function() {
                    // Do not signal the parent if this method is executed by the unload event handler
                    if (!unloading) {
                        connector.broadcast({target: "p", type: "close"});
                    }
                }
            };
        },
        // Base
        base: function(socket, options) {
            var self = {};
            self.uri = {
                open: function() {
                    return support.url(options.url, {id: options.id, when: "open", transport: options.transport, heartbeat: options.heartbeat});
                }
            };
            return self;
        },
        // WebSocket
        ws: function(socket, options) {
            var ws,
                aborted,
                WebSocket = window.WebSocket,
                self = transports.base(socket, options);
            
            if (!WebSocket) {
                return;
            }
            
            self.open = function() {
                // Changes options.url's protocol part to ws or wss
                // options.url is absolute path
                var url = self.uri.open().replace(/^http/, "ws");
                
                ws = new WebSocket(url);
                ws.onopen = function() {
                    socket.fire("open");
                };
                ws.onmessage = function(event) {
                    socket.receive(event.data);
                };
                ws.onerror = function() {
                    socket.fire("close", aborted ? "aborted" : "error");
                };
                ws.onclose = function(event) {
                    socket.fire("close", aborted ? "aborted" : event.wasClean ? "done" : "error");
                };
            };
            self.send = function(data) {
                ws.send(data);
            };
            self.close = function() {
                aborted = true;
                ws.close();
            };
            return self;
        },
        // HTTP Base
        httpbase: function(socket, options) {
            var url = support.url(options.url, {id: options.id}),
                self = transports.base(socket, options);
            
            self.send = !options.crossDomain || support.corsable ?
            // By XMLHttpRequest
            function(data) {
                var xhr = support.xhr();
                xhr.open("POST", url);
                xhr.setRequestHeader("content-type", "text/plain; charset=UTF-8");
                if (support.corsable) {
                    xhr.withCredentials = true;
                }
                xhr.send("data=" + data);
            } : window.XDomainRequest && options.xdrURL ?
            // By XDomainRequest
            function(data) {
                // Only text/plain is supported for the request's Content-Type header
                // from the fourth at http://blogs.msdn.com/b/ieinternals/archive/2010/05/13/xdomainrequest-restrictions-limitations-and-workarounds.aspx
                var xdr = new window.XDomainRequest();
                xdr.open("POST", options.xdrURL.call(socket, url));
                xdr.send("data=" + data);
            } :
            // By HTMLFormElement
            function(data) {
                var iframe,
                    textarea,
                    form = document.createElement("form");
                form.action = url;
                form.target = "socket-" + (++guid);
                form.method = "POST";
                // Internet Explorer 6 needs encoding property
                form.enctype = form.encoding = "text/plain";
                form.acceptCharset = "UTF-8";
                form.style.display = "none";
                form.innerHTML = '<textarea name="data"></textarea><iframe name="' + form.target + '"></iframe>';
                textarea = form.firstChild;
                textarea.value = data;
                iframe = form.lastChild;
                support.on(iframe, "load", function() {
                    document.body.removeChild(form);
                });
                document.body.appendChild(form);
                form.submit();
            };
            self.close = function() {
                // Fires the close event immediately
                // unloading variable prevents those who use this connection from being aborted
                socket.fire("close", unloading ? "error" : "aborted");
                // Aborts the real connection
                self.abort();
                // Sends the abort request to the server
                // this request is supposed to run in unloading event so script tag should be used
                var script = document.createElement("script"),
                    head = document.head || document.getElementsByTagName("head")[0] || document.documentElement;
                script.async = false;
                script.src = support.url(options.url, {id: options.id, when: "abort"});
                script.onload = script.onreadystatechange = function() {
                    if (!script.readyState || /loaded|complete/.test(script.readyState)) {
                        script.onload = script.onreadystatechange = null;
                        if (script.parentNode) {
                            script.parentNode.removeChild(script);
                        }
                    }
                };
                head.insertBefore(script, head.firstChild);
            };
            return self;
        },
        // Streaming - Server-Sent Events
        sse: function(socket, options) {
            var es,
                EventSource = window.EventSource,
                self = transports.httpbase(socket, options);
            
            if (!EventSource) {
                return;
            }
            
            self.open = function() {
                var url = self.uri.open();
                
                es = new EventSource(url, {withCredentials: true});
                es.onopen = function() {
                    socket.fire("open");
                };
                es.onmessage = function(event) {
                    socket.receive(event.data);
                };
                es.onerror = function() {
                    es.close();
                    // There is no way to find whether this connection closed normally or not
                    socket.fire("close", "done");
                };
            };
            self.abort = function() {
                es.close();
            };
            return self;
        },
        // Streaming Base
        streambase: function(socket, options) {
            var buffer = "",
                self = transports.httpbase(socket, options);
            
            // The detail about parsing is explained in the reference implementation
            self.parse = function(chunk) {
                // Strips off the left padding of the chunk that appears in the
                // first chunk and every chunk for Android browser 2 and 3
                chunk = chunk.replace(/^\s+/, "");
                // The chunk should be not empty for correct parsing, 
                if (chunk) {
                    var i, 
                        // String.prototype.split with string separator is reliable cross-browser
                        lines = (buffer + chunk).split("\n\n");
                    
                    for (i = 0; i < lines.length - 1; i++) {
                        socket.receive(lines[i].substring("data: ".length));
                    }
                    buffer = lines[lines.length - 1];
                }
            };
            return self;
        },
        // Streaming - XMLHttpRequest
        streamxhr: function(socket, options) {
            var xhr,
                self = transports.streambase(socket, options);
            
            if ((support.browser.msie && +support.browser.version.split(".")[0] < 10) || (options.crossDomain && !support.corsable)) {
                return;
            }
            
            self.open = function() {
                var index, 
                    length, 
                    url = self.uri.open();
                
                xhr = support.xhr();
                xhr.onreadystatechange = function() {
                    if (xhr.readyState === 3 && xhr.status === 200) {
                        length = xhr.responseText.length;
                        if (!index) {
                            socket.fire("open");
                            self.parse(xhr.responseText);
                        } else if (length > index) {
                            self.parse(xhr.responseText.substring(index));
                        }
                        index = length;
                    } else if (xhr.readyState === 4) {
                        socket.fire("close", xhr.status === 200 ? "done" : "error");
                    }
                };
                xhr.open("GET", url);
                if (support.corsable) {
                    xhr.withCredentials = true;
                }
                xhr.send(null);
            };
            self.abort = function() {
                xhr.abort();
            };
            return self;
        },
        // Streaming - XDomainRequest
        streamxdr: function(socket, options) {
            var xdr,
                XDomainRequest = window.XDomainRequest,
                self = transports.streambase(socket, options);
            
            if (!XDomainRequest || !options.xdrURL) {
                return;
            }
            
            self.open = function() {
                var index, 
                    length, 
                    url = options.xdrURL.call(socket, self.uri.open());
                
                xdr = new XDomainRequest();
                xdr.onprogress = function() {
                    length = xdr.responseText.length;
                    if (!index) {
                        socket.fire("open");
                        self.parse(xdr.responseText);
                    } else {
                        self.parse(xdr.responseText.substring(index));
                    }
                    index = length;
                };
                xdr.onerror = function() {
                    socket.fire("close", "error");
                };
                xdr.onload = function() {
                    socket.fire("close", "done");
                };
                xdr.open("GET", url);
                xdr.send();
            };
            self.abort = function() {
                xdr.abort();
            };
            return self;
        },
        // Streaming - Iframe
        streamiframe: function(socket, options) {
            var doc,
                stop,
                ActiveXObject = window.ActiveXObject,
                self = transports.streambase(socket, options);
            
            if (!ActiveXObject || options.crossDomain) {
                return;
            } else {
                // Internet Explorer 10 Metro doesn't support ActiveXObject
                try {
                    new ActiveXObject("htmlfile");
                } catch (e) {
                    return;
                }
            }
            
            self.open = function() {
                var iframe, 
                    cdoc,
                    url = self.uri.open();
                
                function iterate(fn) {
                    var timeoutId;
                    // Though the interval is 1ms for real-time application, there is a delay between setTimeout calls
                    // For detail, see https://developer.mozilla.org/en/window.setTimeout#Minimum_delay_and_timeout_nesting
                    (function loop() {
                        timeoutId = setTimeout(function() {
                            if (fn() === false) {
                                return;
                            }
                            loop();
                        }, 1);
                    })();
                    return function() {
                        clearTimeout(timeoutId);
                    };
                }
                
                doc = new ActiveXObject("htmlfile");
                doc.open();
                doc.close();
                iframe = doc.createElement("iframe");
                iframe.src = url;
                doc.body.appendChild(iframe);
                cdoc = iframe.contentDocument || iframe.contentWindow.document;
                stop = iterate(function() {
                    // Response container
                    var container;
                    
                    function readDirty() {
                        var text,
                            clone = container.cloneNode(true);
                        // Adds a character not CR and LF to circumvent an Internet Explorer bug
                        // If the contents of an element ends with one or more CR or LF, Internet Explorer ignores them in the innerText property
                        clone.appendChild(cdoc.createTextNode("."));
                        // But the above idea causes \n chars to be replaced with \r\n or for some reason
                        // Restores them to its original state
                        text = clone.innerText.replace(/\r\n/g, "\n");
                        return text.substring(0, text.length - 1);
                    }
                    
                    // Waits the server's container ignorantly
                    if (!cdoc.firstChild) {
                        return;
                    }
                    container = cdoc.body.lastChild;
                    // Detects connection failure
                    if (!container) {
                        socket.fire("close", "error");
                        return false;
                    }
                    socket.fire("open");
                    self.parse(readDirty());
                    // The container is resetable so no index or length variable is needed
                    container.innerText = "";
                    stop = iterate(function() {
                        var text = readDirty();
                        if (text) {
                            container.innerText = "";
                            self.parse(text);
                        }
                        if (cdoc.readyState === "complete") {
                            socket.fire("close", "done");
                            return false;
                        }
                    });
                    return false;
                });
            };
            self.abort = function() {
                stop();
                doc.execCommand("Stop");
            };
            return self;
        },
        // Long polling Base
        longpollbase: function(socket, options) {
            var self = transports.httpbase(socket, options);
            self.uri.poll = function(eventIds) {
                return support.url(options.url, {id: options.id, when: "poll", lastEventIds: eventIds.join(",")});
            };
            self.open = function() {
                self.connect(self.uri.open(), function() {
                    function poll(eventIds) {
                        self.connect(self.uri.poll(eventIds), function(data) {
                            if (data) {
                                var eventIds = [], 
                                    obj = support.parseJSON(data), 
                                    array = !support.isArray(obj) ? [obj] : obj;
                                
                                support.each(array, function(i, event) {
                                    eventIds.push(event.id);
                                });
                                poll(eventIds);
                                support.each(array, function(i, event) {
                                    socket.receive(support.stringifyJSON(event));
                                });
                            } else {
                                socket.fire("close", "done");
                            }
                        });
                    }
                    
                    poll([]);
                    socket.fire("open");
                });
            };
            return self;
        },
        // Long polling - AJAX
        longpollajax: function(socket, options) {
            var xhr,
                self = transports.longpollbase(socket, options);
            
            if (options.crossDomain && !support.corsable) {
                return;
            }
            
            self.connect = function(url, fn) {
                xhr = support.xhr();
                xhr.onreadystatechange = function() {
                    // Avoids c00c023f error on Internet Explorer 9
                    if (xhr.readyState === 4) {
                        if (xhr.status === 200) {
                            fn(xhr.responseText);
                        } else {
                            socket.fire("close", "error");
                        }
                    }
                };
                xhr.open("GET", url);
                if (support.corsable) {
                    xhr.withCredentials = true;
                }
                xhr.send(null);
            };
            self.abort = function() {
                xhr.abort();
            };
            return self;
        },
        // Long polling - XDomainRequest
        longpollxdr: function(socket, options) {
            var xdr,
                XDomainRequest = window.XDomainRequest,
                self = transports.longpollbase(socket, options);
            
            if (!XDomainRequest || !options.xdrURL) {
                return;
            }

            self.connect = function(url, fn) {
                url = options.xdrURL.call(socket, url);
                xdr = new XDomainRequest();
                xdr.onload = function() {
                    fn(xdr.responseText);
                };
                xdr.onerror = function() {
                    socket.fire("close", "error");
                };
                xdr.open("GET", url);
                xdr.send();
            };
            self.abort = function() {
                xdr.abort();
            };
            return self;
        },
        // Long polling - JSONP
        longpolljsonp: function(socket, options) {
            var script,
                callback = jsonpCallbacks.pop() || ("socket_" + (++guid)),
                self = transports.longpollbase(socket, options);
            
            // Attaches callback
            window[callback] = function(data) {
                script.responseText = data;
            };
            socket.one("close", function() {
                // Assings an empty function for browsers which are not able to cancel a request made from script tag
                window[callback] = function() {};
                jsonpCallbacks.push(callback);
            });
            self.uri._open = self.uri.open;
            self.uri.open = function() {
                return self.uri._open.apply(self, arguments) + "&callback=" + callback;
            };
            self.connect = function(url, fn) {
                var head = document.head || document.getElementsByTagName("head")[0] || document.documentElement;
                
                script = document.createElement("script");
                script.async = true;
                script.src = url;
                script.clean = function() {
                    // Assigns null to attributes to avoid memory leak in IE
                    // doing it to src stops connection in IE 6 and 7
                    script.clean = script.src = script.onerror = script.onload = script.onreadystatechange = null;
                    if (script.parentNode) {
                        script.parentNode.removeChild(script);
                    }
                };
                script.onload = script.onreadystatechange = function() {
                    if (!script.readyState || /loaded|complete/.test(script.readyState)) {
                        if (script.clean) {
                            script.clean();
                        }
                        fn(script.responseText);
                    }
                };
                script.onerror = function() {
                    script.clean();
                    socket.fire("close", "error");
                };
                head.insertBefore(script, head.firstChild);                        
            };
            self.abort = function() {
                if (script.clean) {
                    script.clean();
                }
            };
            return self;
        }
    };
    
    return react;
}));