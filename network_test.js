"use strict";

const MA = require('./myAdapter'),
    A = MA.MyAdapter;


const assert = require('assert'),
    dgram = require('dgram'),
    net_ping = require("net-ping"),
    dns = require("dns"),
    oui = require('oui'),
    EventEmitter = require('events').EventEmitter,
    cp = require('child_process');


class Network extends EventEmitter {
    constructor() {
        super();
        this._init = false;
        this._listener = dgram.createSocket('udp4');
        this._ping4session = null;
        this._ping6session = null;
    }
    init() {
        var self = this;

        if (this._ping4session) this._ping4session.close();
        if (this._ping6session) this._ping6session.close();

        this._ping4session = net_ping.createSession({
            networkProtocol: net_ping.NetworkProtocol.IPv4,
            //    packetSize: 16,
            retries: 2,
            //    sessionId: (process.pid % 65535),
            timeout: 1000,
            ttl: 10
        });
        this._ping6session = net_ping.createSession({
            networkProtocol: net_ping.NetworkProtocol.IPv6,
            //    packetSize: 16,
            retries: 2,
            //    sessionId: (process.pid % 65535)-1,
            timeout: 1000,
            ttl: 10
        });

        function parseUdp(msg) {
            function trimNulls(str) {
                var idx = str.indexOf('\u0000');
                return (-1 === idx) ? str : str.substr(0, idx);
            }

            function readIpRaw(msg, offset) {
                //            console.log(`Read IpRaw bl = ${msg.length} offset = ${offset}`)
                if (0 === msg.readUInt8(offset))
                    return undefined;
                return '' +
                    msg.readUInt8(offset++) + '.' +
                    msg.readUInt8(offset++) + '.' +
                    msg.readUInt8(offset++) + '.' +
                    msg.readUInt8(offset++);
            }

            function readIp(msg, offset, obj, name) {
                //            console.log(`Read IP = ${msg.length} offset = ${offset}, name = ${name} `)
                var len = msg.readUInt8(offset++);
                assert.strictEqual(len, 4);
                obj[name] = readIpRaw(msg, offset);
                return offset + len;
            }

            function readString(msg, offset, obj, name) {
                //            console.log(`Read String bl = ${msg.length} offset = ${offset}, name = ${name} `)
                var len = msg.readUInt8(offset++);
                obj[name] = msg.toString('ascii', offset, offset + len);
                offset += len;
                return offset;
            }

            function readAddressRaw(msg, offset, len) {
                var addr = '';
                //            console.log(`Address Raw bl = ${msg.length} offset = ${offset}, len = ${len} `)
                while (len-- > 0) {
                    var b = 0;
                    try {
                        b = msg.readUInt8(offset++);
                    } catch (e) {
                        console.log(`buffer length = ${msg.length} offset = ${offset}, len = ${len}, err = ${e} `);

                    }
                    addr += (b + 0x100).toString(16).substr(-2);
                    if (len > 0) {
                        addr += ':';
                    }
                }
                return addr;
            }
            /*
                    function readHex(msg, offset, obj, name) {
                         console.log(`Read Hex bl = ${msg.length} offset = ${offset}, name = ${name} `)
                       var len = msg.readUInt8(offset++);
                        obj[name] = readHexRaw(msg, offset, len);
                        offset += len;
                        return offset;
                    }
                    function readHexRaw(msg, offset, len) {
                        console.log(`Read HexRaw bl = ${msg.length} offset = ${offset}, len = ${len} `)
                        var data = '';
                        while (len-- > 0) {
                            var b = msg.readUInt8(offset++);
                            data += (b + 0x100).toString(16).substr(-2);
                        }
                        return data;
                    }
            */
            function createHardwareAddress(t, a) {
                return Object.freeze({
                    type: t,
                    address: a
                });
            }
            var BOOTPMessageType = ['NA', 'BOOTPREQUEST', 'BOOTPREPLY'];
            var ARPHardwareType = ['NA', 'HW_ETHERNET', 'HW_EXPERIMENTAL_ETHERNET', 'HW_AMATEUR_RADIO_AX_25', 'HW_PROTEON_TOKEN_RING', 'HW_CHAOS', 'HW_IEEE_802_NETWORKS', 'HW_ARCNET', 'HW_HYPERCHANNEL', 'HW_LANSTAR'];
            var DHCPMessageType = ['NA', 'DHCPDISCOVER', 'DHCPOFFER', 'DHCPREQUEST', 'DHCPDECLINE', 'DHCPACK', 'DHCPNAK', 'DHCPRELEASE', 'DHCPINFORM'];
            var p = {
                op: BOOTPMessageType[msg.readUInt8(0)],
                // htype is combined into chaddr field object
                hlen: msg.readUInt8(2),
                hops: msg.readUInt8(3),
                xid: msg.readUInt32BE(4),
                secs: msg.readUInt16BE(8),
                flags: msg.readUInt16BE(10),
                ciaddr: readIpRaw(msg, 12),
                yiaddr: readIpRaw(msg, 16),
                siaddr: readIpRaw(msg, 20),
                giaddr: readIpRaw(msg, 24),
                chaddr: createHardwareAddress(
                    ARPHardwareType[msg.readUInt8(1)],
                    readAddressRaw(msg, 28, msg.readUInt8(2))),
                sname: trimNulls(msg.toString('ascii', 44, 108)),
                file: trimNulls(msg.toString('ascii', 108, 236)),
                magic: msg.readUInt32BE(236),
                options: {}
            };
            var offset = 240;
            var code = 0;
            while (code !== 255 && offset < msg.length) {
                code = msg.readUInt8(offset++);
                var len;
                switch (code) {
                    case 0:
                        continue; // pad
                    case 255:
                        break; // end
                    case 12:
                        { // hostName
                            offset = readString(msg, offset, p.options, 'hostName');
                            break;
                        }
                    case 50:
                        { // requestedIpAddress
                            offset = readIp(msg, offset, p.options, 'requestedIpAddress');
                            break;
                        }
                    case 53:
                        { // dhcpMessageType
                            len = msg.readUInt8(offset++);
                            assert.strictEqual(len, 1);
                            var mtype = msg.readUInt8(offset++);
                            assert.ok(1 <= mtype);
                            assert.ok(8 >= mtype);
                            p.options.dhcpMessageType = DHCPMessageType[mtype];
                            break;
                        }
                    case 58:
                        { // renewalTimeValue
                            len = msg.readUInt8(offset++);
                            assert.strictEqual(len, 4);
                            p.options.renewalTimeValue = msg.readUInt32BE(offset);
                            offset += len;
                            break;
                        }
                    case 59:
                        { // rebindingTimeValue
                            len = msg.readUInt8(offset++);
                            assert.strictEqual(len, 4);
                            p.options.rebindingTimeValue = msg.readUInt32BE(offset);
                            offset += len;
                            break;
                        }
                    case 61:
                        { // clientIdentifier
                            len = msg.readUInt8(offset++);
                            p.options.clientIdentifier =
                            createHardwareAddress(
                                ARPHardwareType[msg.readUInt8(offset)],
                                readAddressRaw(msg, offset + 1, len - 1));
                            offset += len;
                            break;
                        }
                    case 81:
                        { // fullyQualifiedDomainName
                            len = msg.readUInt8(offset++);
                            p.options.fullyQualifiedDomainName = {
                                flags: msg.readUInt8(offset),
                                name: msg.toString('ascii', offset + 3, offset + len)
                            };
                            offset += len;
                            break;
                        }
                    default:
                        {
                            len = msg.readUInt8(offset++);
                            //console.log('Unhandled DHCP option ' + code + '/' + len + 'b');
                            offset += len;
                            break;
                        }
                }
            }
            return p;
        }

        if (self._init) return;

        self._listener.on('message', function (msg, rinfo) {
            try {
                var data = parseUdp(msg, rinfo);
                if (data.op === 'BOOTPREQUEST' && data.options.dhcpMessageType === 'DHCPREQUEST' && !data.ciaddr && data.options.clientIdentifier) {
                    var req = [data.options.hostName, data.options.clientIdentifier.type, data.options.clientIdentifier.address.toUpperCase(), data.options.requestedIpAddress];
                    //                console.log(`Request  ${req} `);
                    self.emit('request', req);
                }
            } catch (e) {
                console.log(e);
            }
        });
        self._listener.bind(67, () => console.log('Connected'));
    }
    ping(ips, fun) {
        var that = this;

        function pres(ip) {
            ip = ip.trim();
            let session = Network.matchIP4.test(ip) ? that._ping4session : that._ping6session;
            return new Promise((res) => {
                session.pingHost(ip, function (error, target) {
                    if (error) {
                        if (error instanceof net_ping.RequestTimedOutError)
                            console.log(target + ": Not alive");
                        else
                            console.log(target + ": " + error.toString());
                        res(undefined);
                    } else
                        res(fun(target));
                });
            });
        }
        if (typeof ips === 'string')
            ips = [ips];
        if (!Array.isArray(ips))
            return Promise.reject(`Invalid argument for network:'${JSON.stringify(ips)}'`);

        let pip = [];

        for (let i of ips) {
            pip.push(pres(i.trim()));
        }
        return Promise.all(pip);
    }
    dnsReverse(ip) {
        return new Promise((res, rej) => dns.reverse(ip, (err, hosts) => err ? rej(err) : res(hosts))).then(arr => arr.length > 0 ? arr : null, () => null);
    }

    dnsResolve(name) {
        let arr = [];
        return Promise.all([
            new Promise((res, rej) => dns.resolve4(name, (err, hosts) => err ? rej(err) : res(hosts))).then(x => arr = arr.concat(x), () => null),
            new Promise((res, rej) => dns.resolve6(name, (err, hosts) => err ? rej(err) : res(hosts))).then(x => arr = arr.concat(x), () => null)
        ]).then(() => arr.length > 0 ? arr : null);
    }

    getMacVendor(mac) {
        let v = oui(mac),
            vl = v && v.split('\n');
        return v && vl && vl.length > 2 ? vl[0] + '/' + vl[2] : 'Vendor N/A';
    }



    stop() {
        //        clearInterval(this._tester);
        this._init = false;
        if (this._listener) this._listener.close();
        if (this._ping4session) this._ping4session.close();
        if (this._ping6session) this._ping6session.close();
    }
}
Network.matchIP4 = /(((?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?))/;
Network.matchIP6 = /(([0-9A-F]{1,4}:){7,7}[0-9A-F]{1,4}|([0-9A-F]{1,4}:){1,7}:|([0-9A-F]{1,4}:){1,6}:[0-9A-F]{1,4}|([0-9A-F]{1,4}:){1,5}(:[0-9A-F]{1,4}){1,2}|([0-9A-F]{1,4}:){1,4}(:[0-9A-F]{1,4}){1,3}|([0-9A-F]{1,4}:){1,3}(:[0-9A-F]{1,4}){1,4}|([0-9A-F]{1,4}:){1,2}(:[0-9A-F]{1,4}){1,5}|[0-9A-F]{1,4}:((:[0-9A-F]{1,4}){1,6})|:((:[0-9A-F]{1,4}){1,7}|:)|fe80:(:[0-9A-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9A-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))/i;
Network.matchMac = /(([\dA-F]{2}\:){5}[\dA-F]{2})/i;


class ScanCmd extends EventEmitter {
    constructor(args, matchfun) {
        super();
        this._stop = this._single = false;
        this._args = args;
        if (this._args[0][0] === '!') {
            this._single = true;
            this._args[0] = this._args[0].slice(1);
        }
        this._matchfun = matchfun;
        this._cmd = null;
//        this.init();
        return this;
    }

    init() {
        var self = this;
        this._cmd = null;
        try {
            this._cmd = cp.spawn(this._args[0], this._args.slice(1));
            this._cmd.on('error', (e1,e2) => this.emit('error', e1,e2));
//            console.log(this._cmd);
        } catch (e) {
//            console.log(e);
            self.emit('error',`spawn error ${e}`);
            this._cmd = null;
        }
        if (this._cmd) {
            self._cmd.stdout.on('data', (data) => self._matchfun(data.toString(), self));

            self._cmd.stderr.on('data', function (data) {
                console.log(`${self._args} stderr: ${data}`);
                self._stop = true;
                self._cmd = null;
            });

            self._cmd.on('exit', function (code) {
                self.emit('exit', `${self._args} exit code: ${code}`);
                self._cmd = null;
                if (!self._stop && !self._single)
                    self.init();
            });
            self.emit('started', `started ${this._args[0]} ${this._args.slice(1).join(' ')}`);
        }
    }
    get cmd() {
        return this._cmd;
    }
    stop() {
        this._stop = true;
        this.kill();
    }
    kill() {
        if (this._cmd && this._cmd.pid) {
            var pid = this._cmd.pid;
            if (this._args[0] === 'sudo') {
                var ppid = cp.execSync('ps l --ppid ' + pid).toString();
                var re = new RegExp('^\\s*\\d+\\s+\\d+\\s+(\\d+)\\s+' + pid + '\\s+', 'm');
                re = ppid.match(re);
                //                console.log(`will kill ${ re[1] } `);
                if (re && re[1])
                    pid = re[1];
            }
            if (pid)
                cp.execSync(console.log((this._args[0] === 'sudo' ? 'sudo ' : '') + 'kill ' + pid));
        }
        this._cmd = null;
    }
}

//cp.execSync('rfkill block bluetooth');
//cp.execSync('rfkill unblock bluetooth');

var scmd = new ScanCmd(['!arp-scan', '-lgq', '--retry=2'], (data, self) => {
    for (let line of data.split('\n')) {
        var res = [];
        var m1 = line.match(Network.matchMac);
        //        console.log(`Match: ${line}\n${m1}`);
        if (m1 && m1[1])
            res.push(m1[1]);
        m1 = line.match(Network.matchIP4);
        //        console.log(`Match: ${m1}`);
        if (m1 && m1[1])
            res.push(m1[1]);
        if (res.length === 2)
            self.emit('match', res);
    }
    return null;
});
scmd.on('error', console.log);
scmd.on('exit', console.log);
scmd.on('match', console.log);
//scmd.init();


function Ptime(promise) {
    var start =  Date.now();
    return promise.then(() => {
        var end = Date.now();
        return end-start;
    });
}

Ptime(A.exec('sudo arp-scan -lgq --retry=3').then(res => A.I(res), err => A.E(err))).then(ms => A.I(`It took ${ms}ms`));

const network = new Network();
/*
network.on('request', (req) => network.dnsReverse(req[3]).then((names) => console.log(`Request  ${req}= from ${network.getMacVendor(req[2])}, ${names}`)));
network.init();
network.ping(['::1', '::2', '192.168.178.1'], x => console.log(`Ping returned ${x}`))
        .then(() => network.dnsResolve(`bilder.scherz.site`).then(x => console.log(x)))
        .then(() => network.dnsResolve('fritz.box').then(x => console.log(x)))
        .then(() => network.dnsReverse('192.168.178.199').then(x => console.log(x)))
    .catch(err => console.log(err));
*/