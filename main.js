"use strict";

/*
 * Created with @iobroker/create-adapter v1.34.1
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");
const axios = require("axios");

const crypto = require("crypto");
const qs = require("qs");
const { extractKeys } = require("./lib/extractKeys");
const axiosCookieJarSupport = require("axios-cookiejar-support").default;
const tough = require("tough-cookie");
class Bmw extends utils.Adapter {
    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    constructor(options) {
        super({
            ...options,
            name: "bmw",
        });
        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("unload", this.onUnload.bind(this));
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        // Reset the connection indicator during startup
        this.setState("info.connection", false, true);
		this.setState("info.V1APIconnection", false, true);
        if (this.config.interval < 0.5) {
            this.log.info("Set interval to minimum 0.5");
            this.config.interval = 0.5;
        }
        axiosCookieJarSupport(axios);
        this.cookieJar = new tough.CookieJar();
        this.requestClient = axios.create();
        this.cookieJar2 = new tough.CookieJar();
        this.requestClient2 = axios.create();
        this.updateInterval = null;
		this.v1updateInterval = null;
        this.reLoginTimeout = null;
        this.refreshTokenTimeout = null;
		this.v1refreshTokenTimeout = null;
        this.extractKeys = extractKeys;
        this.vinArray = [];
        this.session = {};
        this.v1session = {};
        this.statusBlock = {};
        this.nonChargingHistory = {};
        this.subscribeStates("*");
        if (!this.config.username || !this.config.password) {
            this.log.error("Please set username and password");
            return;
        }
        await this.login();
        if (this.session.access_token) {
            await this.cleanObjects();
            await this.getVehiclesv2();
            this.updateInterval = setInterval(async () => {
                await this.getVehiclesv2();
            }, this.config.interval * 60 * 1000);
            this.refreshTokenInterval = setInterval(() => {
                this.refreshToken();
            }, this.session.expires_in * 1000);
        }
		
		//V1 Login and Data request
        await this.v1login()
        if (this.v1session.access_token) {
			this.log.debug("V1 Login Success!! Token recived!");
            await this.v1getVehicles();
			await this.v1updateVehicles();
			this.v1updateInterval = setInterval(async () => {
                await this.v1updateVehicles();
            }, this.config.interval * 60 * 1000);
            this.v1refreshTokenInterval = setInterval(() => {
                this.v1login();
            }, this.v1session.expires_in * 1000);
        }
    }

    async v1login() {	  
      const v1data = {
			username: this.config.username,
			password: this.config.password,
			//client_id: 'dbf0a542-ebd1-4ff0-a9a7-55172fbfce35',
			client_id: '31c357a0-7a1d-4590-aa99-33b97244d048',
			redirect_uri: 'com.bmw.connected://oauth',
			response_type: 'token',
			scope: 'openid profile email offline_access smacc vehicle_data perseus dlm svds cesim vsapi remote_services fupo authenticate_user',
			locale: 'DE-de'
        };
		
	  const v1headers = {
		'Accept': 'application/json',
		'Content-Type': 'application/x-www-form-urlencoded'
      };
	  
	  var tempdata = '';
	  var loc ='';
	  	  
	  const v1authUrl = await this.requestClient2({
		  method: 'post',
          url: 'https://customer.bmwgroup.com/gcdm/oauth/authenticate',
		  headers: v1headers,
		  data: qs.stringify(v1data),
		  validateStatus: function (status) {
				return status >= 200 && status < 303; // Changed for BMW API Status 302
		  },
		  maxRedirects: 0, //needed for Response URL with token
		  jar: this.cookieJar2,
          withCredentials: true,
      })
			.then((res) => {
				this.log.debug("Response V1API Status:");
				this.log.debug(JSON.stringify(res.status));
				this.log.debug(JSON.stringify(res.statusText));
				this.log.debug("Response V1API Login:");
				this.log.debug(JSON.stringify(res.headers));
				this.log.debug("Token V1API:");
				this.log.debug(JSON.stringify(res.headers.location));
				loc = qs.parse((JSON.stringify(res.headers.location)).split("#")[1]);
				loc.expires_in = loc.expires_in.replace(/"/i, "");
				this.log.debug(loc.access_token);
				this.log.debug(loc.token_type);
				this.log.debug(loc.expires_in);
				this.v1session = loc;
				this.setState("info.V1APIconnection", true, true);
                return res.data;
              })
            .catch((error) => {
				this.log.debug("ErrorV1Login:");
				this.log.error(JSON.stringify(error.config.url));
                if (error.response) {
					this.log.debug("ResponseErrorV1Login:");
                    this.log.error(JSON.stringify(error.response.headers));
					this.log.error(JSON.stringify(error.response.status));
                }
                if (error.response && error.response.status === 401) {
                    this.log.error("Please check username and password");
                }
                if (error.response && error.response.status === 400) {
                    this.log.error("Please check username and password");
                }
                });
	  }
	
    async login() {
        const headers = {
            Accept: "application/json, text/plain, */*",
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 12_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1",
            "Accept-Language": "de-de",
            "Content-Type": "application/x-www-form-urlencoded",
        };
		
		//"openid profile email offline_access smacc vehicle_data perseus dlm svds cesim vsapi remote_services fupo authenticate_user",
        const [code_verifier, codeChallenge] = this.getCodeChallenge();
        const data = {
            client_id: "31c357a0-7a1d-4590-aa99-33b97244d048",
            response_type: "code",
            scope: "openid profile email offline_access smacc vehicle_data perseus dlm svds cesim vsapi remote_services fupo authenticate_user",
            redirect_uri: "com.bmw.connected://oauth",
            state: "cwU-gIE27j67poy2UcL3KQ",
            nonce: "login_nonce",
            code_challenge_method: "S256",
            code_challenge: codeChallenge,
            username: this.config.username,
            password: this.config.password,
            grant_type: "authorization_code",
        };

        const authUrl = await this.requestClient({
            method: "post",
            url: "https://customer.bmwgroup.com/gcdm/oauth/authenticate",
            headers: headers,
            data: qs.stringify(data),
            jar: this.cookieJar,
            withCredentials: true,
        })
            .then((res) => {
                this.log.debug(JSON.stringify(res.data));
                return res.data;
            })
            .catch((error) => {
                this.log.error(error);
                if (error.response) {
                    this.log.error(JSON.stringify(error.response.data));
                }
                if (error.response && error.response.status === 401) {
                    this.log.error("Please check username and password or too many logins in 5 minutes");

                    this.log.error("Start relogin in 5min");
                    this.reLoginTimeout && clearTimeout(this.reLoginTimeout);
                    this.reLoginTimeout = setTimeout(() => {
                        this.login();
                    }, 5000 * 60 * 1);
                }
                if (error.response && error.response.status === 400) {
                    this.log.error("Please check username and password");
                }
            });
        if (!authUrl || !authUrl.redirect_to) {
            this.log.error(JSON.stringify(authUrl));
            return;
        }

        delete data.username;
        delete data.password;
        delete data.grant_type;
        data.authorization = qs.parse(authUrl.redirect_to).authorization;
        const code = await this.requestClient({
            method: "post",
            url: "https://customer.bmwgroup.com/gcdm/oauth/authenticate",
            headers: headers,
            data: qs.stringify(data),
            jar: this.cookieJar,
            withCredentials: true,
        })
            .then((res) => {
                this.log.debug(JSON.stringify(res.data));
                return res.data;
            })
            .catch((error) => {
                let code = "";
                if (error.response && error.response.status === 400) {
                    this.log.error(JSON.stringify(error.response.data));
                    return;
                }
                if (error.config) {
                    this.log.debug(JSON.stringify(error.config.url));
                    code = qs.parse(error.config.url.split("?")[1]).code;
                    this.log.debug(code);
                    return code;
                }
            });
        await this.requestClient({
            method: "post",
            url: "https://customer.bmwgroup.com/gcdm/oauth/token",

            jar: this.cookieJar,
            withCredentials: true,
            headers: {
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "User-Agent": "My%20BMW/8932 CFNetwork/978.0.7 Darwin/18.7.0",
                Accept: "*/*",
                "Accept-Language": "de-de",
                Authorization: "Basic MzFjMzU3YTAtN2ExZC00NTkwLWFhOTktMzNiOTcyNDRkMDQ4OmMwZTMzOTNkLTcwYTItNGY2Zi05ZDNjLTg1MzBhZjY0ZDU1Mg==",
            },
            data: "code=" + code + "&redirect_uri=com.bmw.connected://oauth&grant_type=authorization_code&code_verifier=" + code_verifier,
        })
            .then((res) => {
                this.log.debug(JSON.stringify(res.data));
                this.session = res.data;
                this.setState("info.connection", true, true);
                return res.data;
            })
            .catch((error) => {
                this.log.error(error);
                if (error.response) {
                    this.log.error(JSON.stringify(error.response.data));
                }
            });
    }
	
    getCodeChallenge() {
        let hash = "";
        let result = "";
        const chars = "0123456789abcdef";
        result = "";
        for (let i = 64; i > 0; --i) result += chars[Math.floor(Math.random() * chars.length)];
        hash = crypto.createHash("sha256").update(result).digest("base64");
        hash = hash.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

        return [result, hash];
	}

    async v1getVehicles() {
        const headers = {
			"x-user-agent": "android(v1.07_20200330);BMW;1.5.2(8932)",
			Authorization: "Bearer " + this.v1session.access_token,
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
            };
        await this.requestClient({
            method: "get",
            url: "https://b2vapi.bmwgroup.com/api/me/vehicles/v2?all=true",
            headers: headers,
        })
            .then(async (res) => {
                this.log.debug("Result V1 Vehicles:");
                this.log.debug(JSON.stringify(res.data));
                for (const vehicle of res.data) {
                    this.vinArray.push(vehicle.vin);
                    await this.setObjectNotExistsAsync(vehicle.vin, {
                        type: "device",
                        common: {
                            name: vehicle.model,
                        },
                        native: {},
                    });
                    await this.setObjectNotExistsAsync(vehicle.vin + ".V1API.general", {
                        type: "channel",
                        common: {
                            name: "General Car Information",
                        },
                        native: {},
                    });

                    this.extractKeys(this, vehicle.vin + ".V1API.general", vehicle);
					//this.rangeMapSupport[vehicle.vin] = vehicle.rangeMap === "NOT_SUPPORTED" ? false : true;
                }
            })
            .catch((error) => {
				this.log.error("Error V1API getVehicles:");
                this.log.error(JSON.stringify(error));
                error.response && this.log.error(JSON.stringify(error.response.data));
            });
    }

    async v1updateVehicles() {
        const date = this.getDate();
        const statusArray = [
		{ path: "V1API.status", url: "https://b2vapi.bmwgroup.com/api/vehicle/dynamic/v1/$vin", desc: "Current status of the car v1" },
            //{ path: "V1API.status", url: "https://b2vapi.bmwgroup.com/api/vehicle/dynamic/v1/$vin?offset=-60", desc: "Current status of the car v1" },
            //{ path: "V1API.chargingprofile", url: "https://b2vapi.bmwgroup.com/api/v1/user/vehicles/$vin/chargingprofile", desc: "Charging profile of the car v1" },
            //{ path: "V1API.lastTrip", url: "https://b2vapi.bmwgroup.com/api/v1/user/vehicles/$vin/statistics/lastTrip", desc: "Last trip of the car v1" },
            //{ path: "V1API.allTrips", url: "https://b2vapi.bmwgroup.com/api/v1/user/vehicles/$vin/statistics/allTrips", desc: "All trips of the car v1" },
            //{ path: "V1API.serviceExecutionHistory", url: "https://b2vapi.bmwgroup.com/api/v1/user/vehicles/$vin/serviceExecutionHistory", desc: "Remote execution history v1" },
            //{ path: "V1API.apiV2", url: "https://b2vapi.bmwgroup.com/api/vehicle/v2/$vin", desc: "Limited v2 Api of the car" },
		{ path: "V1API.socnavigation", url: "https://b2vapi.bmwgroup.com/api/vehicle/navigation/v1/$vin" },
        ];
        const headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
            Authorization: "Bearer " + this.v1session.access_token,
        };
        this.vinArray.forEach((vin) => {
             /*if (this.rangeMapSupport[vin]) {
                statusArray.push({ path: "V1API.rangemap", url: "https://b2vapi.bmwgroup.com/api/v1/user/vehicles/$vin/rangemap?deviceTime=" + date });
            } */
            statusArray.forEach(async (element) => {
                const url = element.url.replace("$vin", vin);
                await this.requestClient({
                    method: "get",
                    url: url,
                    headers: headers,
                })
                    .then((res) => {
                        this.log.debug(JSON.stringify(res.data));
                        if (!res.data) {
                            return;
                        }
                        let data = res.data;
                        const keys = Object.keys(res.data);
						this.log.debug(JSON.stringify(keys));
						this.log.debug(keys);
                        if (keys.length === 1) {
                            data = res.data[keys[0]];
                        }
                        let forceIndex = null;
                        const preferedArrayName = null;
                        if (element.path === "V1API.serviceExecutionHistory") {
                            forceIndex = true;
                        }
						if (data.attributesMap) {
							this.log.debug("attributesMap found. Decode to Status..");
							this.extractKeys(this, vin + "." + element.path, data.attributesMap, preferedArrayName, forceIndex, false, element.desc);
							if (data.vehicleMessages) {
								this.log.debug("vehicleMessages found. Decode to Service..");
								this.extractKeys(this, vin + "." + "V1API.service", data.vehicleMessages, preferedArrayName, forceIndex, false, element.desc);
							}
						}
						else {
							this.log.debug("Normal Decode");
							this.extractKeys(this, vin + "." + element.path, data, preferedArrayName, forceIndex, false, element.desc);
						}
                    })
                    .catch((error) => {
                        if (error.response && error.response.status === 401) {
                            error.response && this.log.debug(JSON.stringify(error.response.data));
                            this.log.info(element.path + " receive 401 error. Refresh Token in 30 seconds");
                            clearTimeout(this.refreshTokenTimeout);
                            this.v1refreshTokenTimeout = setTimeout(() => {
                                this.v1login();
                            }, 1000 * 30);
                            return;
                        }
                        this.log.error(element.url);
                        this.log.error(error);
                        error.response && this.log.debug(JSON.stringify(error.response.data));
                    });
            });
        });
	}
	
    async getVehiclesv2() {
        const brands = ["bmw", "mini"];
        for (const brand of brands) {
            const headers = {
                "user-agent": "Dart/2.10 (dart:io)",
                "x-user-agent": "android(v1.07_20200330);" + brand + ";1.5.2(8932)",
                authorization: "Bearer " + this.session.access_token,
                "accept-language": "de-DE",
                host: "cocoapi.bmwgroup.com",
                "24-hour-format": "true",
            };

            await this.requestClient({
                method: "get",
                url: "https://cocoapi.bmwgroup.com/eadrax-vcs/v1/vehicles?apptimezone=120&appDateTime=" + Date.now() + "&tireGuardMode=ENABLED",
                headers: headers,
            })
                .then(async (res) => {
                    this.log.debug(JSON.stringify(res.data));

                    for (const vehicle of res.data) {
                        await this.setObjectNotExistsAsync(vehicle.vin, {
                            type: "device",
                            common: {
                                name: vehicle.model,
                            },
                            native: {},
                        });

                        await this.setObjectNotExistsAsync(vehicle.vin + ".properties", {
                            type: "channel",
                            common: {
                                name: "Current status of the car v2",
                            },
                            native: {},
                        });
                        await this.setObjectNotExistsAsync(vehicle.vin + ".remotev2", {
                            type: "channel",
                            common: {
                                name: "Remote Controls",
                            },
                            native: {},
                        });

                        const remoteArray = [
                            { command: "door-lock" },
                            { command: "door-unlock" },
                            { command: "horn-blow" },
                            { command: "light-flash" },
                            { command: "vehicle-finder" },
                            { command: "climate-now_START" },
                            { command: "climate-now_STOP" },
                            { command: "force-refresh", name: "Force Refresh" },
                        ];
                        remoteArray.forEach((remote) => {
                            this.setObjectNotExists(vehicle.vin + ".remotev2." + remote.command, {
                                type: "state",
                                common: {
                                    name: remote.name || "",
                                    type: remote.type || "boolean",
                                    role: remote.role || "boolean",
                                    write: true,
                                    read: true,
                                },
                                native: {},
                            });
                        });
                        this.extractKeys(this, vehicle.vin, vehicle, null, true);
                        this.updateChargingSessionv2(vehicle.vin);
                    }
                })
                .catch((error) => {
                    this.log.error(error);
                });
        }
    }

    async updateChargingSessionv2(vin) {
        if (this.nonChargingHistory[vin]) {
            return;
        }
        const headers = {
            "user-agent": "Dart/2.10 (dart:io)",
            "x-user-agent": "android(v1.07_20200330);bmw;1.5.2(8932)",
            authorization: "Bearer " + this.session.access_token,
            "accept-language": "de-DE",
            "24-hour-format": "true",
        };
        const d = new Date();
        const dateFormatted = d.getFullYear().toString() + "-" + ((d.getMonth() + 1).toString().length == 2 ? (d.getMonth() + 1).toString() : "0" + (d.getMonth() + 1).toString());
        // const day = d.getDate().toString().length == 2 ? d.getDate().toString() : "0" + d.getDate().toString();
        const fullDate = new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().replace("Z", "000");

        const urlArray = [];
        urlArray.push({
            url: "https://cocoapi.bmwgroup.com/eadrax-chs/v1/charging-sessions?vin=" + vin + "&next_token&date=" + dateFormatted + "-01T00%3A00%3A00.000Z&maxResults=40&include_date_picker=true",
            path: ".chargingSessions.",
            name: "chargingSessions",
        });

        urlArray.push({
            url: "https://cocoapi.bmwgroup.com/eadrax-chs/v1/charging-statistics?vin=" + vin + "&currentDate=" + fullDate,
            path: ".charging-statistics.",
            name: "Charging statistics",
        });
        for (const element of urlArray) {
            await this.requestClient({
                method: "get",
                url: element.url,
                headers: headers,
            })
                .then(async (res) => {
                    this.log.debug(JSON.stringify(res.data));
                    let data = res.data;
                    if (data.chargingSessions) {
                        data = data.chargingSessions;
                    }
                    await this.setObjectNotExistsAsync(vin + element.path + dateFormatted, {
                        type: "channel",
                        common: {
                            name: element.name + " of the car v2",
                        },
                        native: {},
                    });

                    this.extractKeys(this, vin + element.path + dateFormatted, data);
                })
                .catch((error) => {
                    if (error.response && (error.response.status === 422 || error.response.status === 403)) {
                        this.log.info("No charging session available. Ignore " + vin);
                        this.nonChargingHistory[vin] = true;
                        return;
                    }
                    this.log.error(element.url);
                    this.log.error(error);
                    error.response && this.log.error(JSON.stringify(error.response.data));
                });
        }
    }

    async cleanObjects() {
        for (const vin of this.vinArray) {
            const remoteState = await this.getObjectAsync(vin + ".apiV2");

            if (remoteState) {
                this.log.debug("clean old states" + vin);
                await this.delObjectAsync(vin + ".statusv1", { recursive: true });
                await this.delObjectAsync(vin + ".lastTrip", { recursive: true });
                await this.delObjectAsync(vin + ".allTrips", { recursive: true });
                await this.delObjectAsync(vin + ".status", { recursive: true });
                await this.delObjectAsync(vin + ".chargingprofile", { recursive: true });
                await this.delObjectAsync(vin + ".serviceExecutionHistory", { recursive: true });
                await this.delObjectAsync(vin + ".apiV2", { recursive: true });
                await this.delObject(vin + ".remote", { recursive: true });
                await this.delObject("_DatenNeuLaden");
                await this.delObject("_LetzterDatenabrufOK");
                await this.delObject("_LetzerFehler");
            }
        }
    }
	
    getDate() {
        const d = new Date();

        const date_format_str =
            d.getFullYear().toString() +
            "-" +
            ((d.getMonth() + 1).toString().length == 2 ? (d.getMonth() + 1).toString() : "0" + (d.getMonth() + 1).toString()) +
            "-" +
            (d.getDate().toString().length == 2 ? d.getDate().toString() : "0" + d.getDate().toString()) +
            "T" +
            (d.getHours().toString().length == 2 ? d.getHours().toString() : "0" + d.getHours().toString()) +
            ":" +
            (d.getMinutes().toString().length == 2 ? d.getMinutes().toString() : "0" + d.getMinutes().toString()) +
            ":00";
        return date_format_str;
    }

    async refreshToken() {
        await this.requestClient({
            method: "post",
            url: "https://customer.bmwgroup.com/gcdm/oauth/token",
            jar: this.cookieJar,
            withCredentials: true,
            headers: {
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                Accept: "*/*",
                Authorization: "Basic MzFjMzU3YTAtN2ExZC00NTkwLWFhOTktMzNiOTcyNDRkMDQ4OmMwZTMzOTNkLTcwYTItNGY2Zi05ZDNjLTg1MzBhZjY0ZDU1Mg==",
            },
            data: "redirect_uri=com.bmw.connected://oauth&refresh_token=" + this.session.refresh_token + "&grant_type=refresh_token",
        })
            .then((res) => {
                this.log.debug(JSON.stringify(res.data));
                this.session = res.data;
                this.setState("info.connection", true, true);
                return res.data;
            })
            .catch((error) => {
                this.log.error("refresh token failed");
                this.log.error(error);
                error.response && this.log.error(JSON.stringify(error.response.data));
                this.log.error("Start relogin in 1min");
                this.reLoginTimeout && clearTimeout(this.reLoginTimeout);
                this.reLoginTimeout = setTimeout(() => {
                    this.login();
                }, 1000 * 60 * 1);
            });
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     * @param {() => void} callback
     */
    onUnload(callback) {
        try {
            clearTimeout(this.refreshTimeout);
            clearTimeout(this.reLoginTimeout);
            clearTimeout(this.refreshTokenTimeout);
            clearInterval(this.updateInterval);
            clearInterval(this.refreshTokenInterval);
            callback();
        } catch (e) {
            callback();
        }
    }

    /**
     * Is called if a subscribed state changes
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */
    async onStateChange(id, state) {
        if (state) {
            if (!state.ack) {
                if (id.indexOf(".remotev2.") === -1) {
                    this.log.warn("Please use remotev2 to control");
                    return;
                }

                const vin = id.split(".")[2];

                let command = id.split(".")[4];
                if (command === "force-refresh") {
                    this.log.debug("force refresh");
                    this.getVehiclesv2();
					this.v1updateVehicles();
                    return;
                }
                const action = command.split("_")[1];
                command = command.split("_")[0];

                const headers = {
                    "user-agent": "Dart/2.10 (dart:io)",
                    "x-user-agent": "android(v1.07_20200330);bmw;1.5.2(8932)",
                    authorization: "Bearer " + this.session.access_token,
                    "accept-language": "de-DE",
                    host: "cocoapi.bmwgroup.com",
                    "24-hour-format": "true",
                    "Content-Type": "text/plain",
                };
                let url = "https://cocoapi.bmwgroup.com/eadrax-vrccs/v2/presentation/remote-commands/" + vin + "/" + command;
                if (action) {
                    url += "?action=" + action;
                }

                await this.requestClient({
                    method: "post",
                    url: url,
                    headers: headers,
                })
                    .then((res) => {
                        this.log.debug(JSON.stringify(res.data));
                        return res.data;
                    })
                    .catch((error) => {
                        this.log.error(error);
                        if (error.response) {
                            this.log.error(JSON.stringify(error.response.data));
                        }
                    });
                this.refreshTimeout = setTimeout(async () => {
                    await this.getVehiclesv2();
                }, 10 * 1000);
            } else {
                // const resultDict = { chargingStatus: "CHARGE_NOW", doorLockState: "DOOR_LOCK" };
                // const idArray = id.split(".");
                // const stateName = idArray[idArray.length - 1];
                const vin = id.split(".")[2];
                // if (resultDict[stateName]) {
                //     let value = true;
                //     if (!state.val || state.val === "INVALID" || state.val === "NOT_CHARGING" || state.val === "ERROR" || state.val === "UNLOCKED") {
                //         value = false;
                //     }
                //     await this.setStateAsync(vin + ".remote." + resultDict[stateName], value, true);
                // }

                if (id.indexOf(".chargingStatus") !== -1 && state.val !== "CHARGING") {
                    await this.setObjectNotExistsAsync(vin + ".status.chargingTimeRemaining", {
                        type: "state",
                        common: {
                            name: "chargingTimeRemaining",
                            role: "value",
                            type: "number",
                            write: false,
                            read: true,
                        },
                        native: {},
                    });
                    this.setState(vin + ".status.chargingTimeRemaining", 0, true);
                }
            }
        }
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    module.exports = (options) => new Bmw(options);
} else {
    // otherwise start the instance directly
    new Bmw();
}
