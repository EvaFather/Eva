/*
------------------------------------------
@Date: 2026.08.31
@Description: 飞蚂蚁回收 双小程序签到/任务 (openapp.fmy90.com, 四端抓包模式) - 修复A/B端互不覆盖版
new Env("飞蚂蚁回收");
cron 10 10,21 * * * fyhs_fmy_v3.js
基于: Sliverkiss fyhs.js (四端 Env 框架 + login 抓包) + 双端逻辑 + 适配 GLOBAL.md 规范

脚本兼容：Surge、QuantumultX、Loon、Shadowrocket、Node.js
  - 手机端四端: script-response-body 抓 /auth/wx/login 响应自动存 token，业务直接带 Authorization
  - Node(青龙): 通过环境变量 fyhs_data 传已抓取的 token 数组 JSON
  - 抓包拦截点: auth/wx/login (登录接口响应带 data.token + data.user.userId + data.user.userPhone)

【双端说明】
  - 飞蚂蚁有 端A/端B 两个小程序(同任务体系, 仅 appId/platformKey 不同)
  - 抓包时按请求 Referer 中 appId 自动分端写入 (端A=wx501990400906c9ff / 端B=wxc09bdd9274276021)
  - 执行: 同一 userId 两端 token 都有 → 端A、端B 都跑(双倍任务/积分, 用户要求)
  - 存储按账号分端: {"userId":..,"A":{"token":..},"B":{"token":..}}

变量 fyhs_data, 多账号 JSON 数组格式 (双端分存储)
  - 手机端: 抓包自动写入(分别打开端A/端B 小程序触发 login 即捕获两端), 无需手动配
  - Node: process.env.fyhs_data = 数组JSON，如 [{"userId":"123","userName":"138****5678","A":{"token":"bearer xxx"},"B":{"token":"bearer yyy"}}]
  - 续期: /auth/refresh/token 15天自动续期(手机端自动存存储；青龙需手动同步 env)

[rewrite_local]
# 抓包双模式 (推荐①, 信息全②), 均按 Referer appId 分端A/B
#  ① request-header 拦任何业务接口请求头 → 自动抓 Authorization(token), 老端打开即触发, 无需重登 ← 推荐
#  ② response-body  拦 /auth/wx/login 响应 → 拿 token+userId+手机号(能做同会员去重), 但需重登/清缓存才触发
# (以下为各端配置示例, 脚本参数/语法按各端格式; pattern 以下用请求头模式①)
# Loon:
#   [Script]
#   http-request ^https:\/\/openapp\.fmy90\.com\/(user|shop|sign|active|step|home)\/ script-path=https://gist.githubusercontent.com/Sliverkiss/d744c74d780f47cd85f6980ca5014170/raw/fyhs.js, tag=飞蚂蚁回收抓包
#   [MITM] hostname = openapp.fmy90.com
# Surge:
#   [Script] type=http-request, pattern=^https:\/\/openapp\.fmy90\.com\/(user|shop|sign|active|step|home)\/
#   [MITM] hostname = %APPEND% openapp.fmy90.com
# Quantumult X:
#   [rewrite_local] ^https:\/\/openapp\.fmy90\.com\/(user|shop|sign|active|step|home)\/ url script-request-header https://gist.githubusercontent.com/Sliverkiss/d744c74d780f47cd85f6980ca5014170/raw/fyhs.js
#   [mitm] hostname = openapp.fmy90.com
# Shadowrocket:
#   [Script] http-request https://gist.githubusercontent.com/Sliverkiss/d744c74d780f47cd85f6980ca5014170/raw/fyhs.js requires-body = false, pattern = ^https:\/\/openapp\.fmy90\.com\/(user|shop|sign|active|step|home)\/
#   [MITM] hostname = openapp.fmy90.com
# (若要拿 userId/手机号做同会员去重: 改用 script-response-body 拦 ^https:\/\/openapp\.fmy90\.com\/auth\/wx\/login, 重登时触发)

[MITM]
hostname = openapp.fmy90.com

存储键: fyhs_data (账号token数组, 按账号分端A/B) / is_debug (调试开关, 默认关)

⚠️【免责声明】
------------------------------------------
1、此脚本仅用于学习研究，不保证其合法性、准确性、有效性，请根据情况自行判断，本人对此不承担任何保证责任。
2、由于此脚本仅用于学习研究，您必须在下载后 24 小时内将所有内容从您的计算机或手机或任何存储设备中完全删除，若违反规定引起任何事件本人对此均不负责。
3、请勿将此脚本用于任何商业或非法目的，若违反规定请自行对此负责。
4、此脚本涉及应用与本人无关，本人对因此引起的任何隐私泄漏或其他后果不承担任何责任。
5、本人对任何脚本引发的问题概不负责，包括但不限于由脚本错误引起的任何损失和损害。
6、如果任何单位或个人认为此脚本可能涉嫌侵犯其权利，应及时通知并提供身份证明，所有权证明，我们将在收到认证文件确认后删除此脚本。
7、所有直接或间接使用、查看此脚本的人均应该仔细阅读此声明。本人保留随时更改或补充此声明的权利。一旦您使用或复制了此脚本，即视为您已接受此免责声明。
------------------------------------------
*/
const $ = new Env("飞蚁回收");
//notify
const notify = $.isNode() ? require('./sendNotify') : '';
const ckName = "fyhs_data";
const userCookie = $.toObj($.isNode() ? process.env[ckName] : $.getdata(ckName)) || [];
// 双小程序(端A/端B): 任务体系相同, 仅 appId/platformKey 不同; 用户要求同 userId 两端都跑(双倍签到/任务)
const APP_LIST = {
  A: { appId: "wx501990400906c9ff", platformKey: "F2EE24892FBF66F0AFF8C0EB532A9394", label: "端A" },
  B: { appId: "wxc09bdd9274276021", platformKey: "9F7BCAA99BFB660433683C436348BA3B", label: "端B" }
};
// 任务卡专属 platformKey (两端口通用); Node 可用环境变量 FYHS_TASK_PLATFORM_KEY 覆盖
let TASK_PLATFORM_KEY = "90EE1D21919D80F026360A3B71F09327";
try { if (typeof process!=='undefined' && process.env && process.env.FYHS_TASK_PLATFORM_KEY) TASK_PLATFORM_KEY = process.env.FYHS_TASK_PLATFORM_KEY; } catch(_e) {}
//用户多账号配置
$.userIdx = 0, $.userList = [], $.notifyMsg = [];
//成功个数
$.succCount = 0;
//debug (统一开关: /^(true|1|yes|on)$/i, 默认关)
function getDebug(){ try{ const v=$.isNode() ? process.env.IS_DEBUG : $.getdata('is_debug'); return /^(true|1|yes|on)$/i.test(String(v||'')); }catch(_e){ return false; } }
$.is_debug = getDebug();
/** 敏感值脱敏: 默认只显示前3+后3 (token/手机号等) */
function maskString(s){
  if(s==null) return '';
  const str=String(s);
  if(str.length<=8) return str.slice(0,3)+'***';
  return str.slice(0,3)+'****'+str.slice(-3);
}
function randInt(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }
function sdelay(minMs,maxMs){ return new Promise(r=>setTimeout(r, randInt(minMs,maxMs))); }
//------------------------------------------
async function main() {
    const N = $.userList.length;
    for (let ui = 0; ui < N; ui++) {
        const user = $.userList[ui];
        try {
            //自动续期
            //await user.upDateToken();
            let pointF = await user.getBean();
            if (user.ckStatus) {
                await user.signin();
                await user.alipayTask();
                for (let i = 1; i <= 3; i++) {
                    let res = await user.step();
                    if (res) break;
                }
                await user.poolSign();
                await user.bet();
                await user.turntableInfo();  // 转盘奖品查询(总输出)
                await user.draw();   // 转盘抽奖(fmy_draw开关控制)
                if (user.endKey === 'B') {
                    await user.answerInvite();  // B端专属: 答题红包
                }
                let pointE = await user.getBean();
                let str = pointE >= pointF ? '+' : '-';
                $.notifyMsg.push(`用户:${user.userName}[${user.label}] 积分:${pointF}${str}${pointE - 0 - pointF}`);
                $.succCount++;
            } else {
                DoubleLog(`⛔️ 「${user.userName ?? `账号${index}`}」签到失败, 用户需要去登录`)
            }
        } catch (e) {
            throw e
        }
        // 账号/端间延迟, 防连发风控 (双端都要跑, 请求量翻倍)
        if (ui < N - 1) await sdelay(2000, 3500);
    }
    $.title = `共${$.userList.length}个账号,成功${$.succCount}个,失败${$.userList.length - 0 - $.succCount}个`
    //notify
    await sendMsg($.notifyMsg.join("\n"), { $media: $.avatar });
}
//用户
class UserInfo {
    constructor(user, endKey) {
        // 当前端配置 (端A/端B)
        this.endKey = (endKey === 'B' || endKey === 'A') ? endKey : 'A';
        const ecfg = APP_LIST[this.endKey];
        this.appId = ecfg.appId;
        this.platformKey = ecfg.platformKey;
        this.label = ecfg.label;
        //默认属性
        this.index = ++$.userIdx;
        const eTok = (user && user[this.endKey] && user[this.endKey].token) ? user[this.endKey].token : (user && user.token);
        this.token = eTok || "";
        this.userId = "" || user.userId;
        this.drawCount = 0;
        this.drawStatus = true
        this.userName = user.userName || user.ref || `账号${this.index}`;
        this.avatar = user.avatar;
        this.ckStatus = true;
        //请求封装
        this.baseUrl = `https://openapp.fmy90.com`;
        this.headers = {
            'Accept-Encoding': 'gzip,compress,br,deflate',
            'Connection': 'keep-alive',
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_1_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.52(0x18003421) NetType/4G Language/zh_CN',
            'Authorization': this.token
        }
        this.fetch = async (o) => {
            try {
                if (typeof o === 'string') o = { url: o };
                o.dataType = o.dataType || "json";
                o.type = o.type || "post";
                o.type == "post" && (o.body = {
                    "version": "V2.00.01",
                    "platformKey": this.platformKey,
                    "mini_scene": 1089,
                    "partner_ext_infos": "",
                    ...o.body
                })
                if (o.type == "get" || o.type == "GET") {
                    // GET 公参拼到 URL query (兼容已含 ? 的URL: 用 & 追加)
                    const pub = {
                        "version": "V2.00.01",
                        "platformKey": this.platformKey,
                        "mini_scene": 1089,
                        "partner_ext_infos": ""
                    };
                    const qs = Object.entries(pub).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
                    o.url = o.url + (/\?/.test(o.url) ? '&' : '?') + qs;
                }
                if ((!o?.url) || o?.url?.startsWith("/") || o?.url?.startsWith(":")) o.url = this.baseUrl + (o.url || '')
                const res = await Request({ ...o, headers: o.headers || this.headers, url: o.url })
                // 任务链防连发: 每请求间加 1~2.5s 延迟 (md 任务链延迟铁律)
                await sdelay(1000, 2500);
                debug(res, o?.url?.replace(/\/+$/, '').substring(o?.url?.lastIndexOf('/') + 1));
                if (res?.code == "500") throw new Error(res?.Message || `用户需要去登录`);
                return res;
            } catch (e) {
                this.ckStatus = false;
                $.log(`[${this.userName || this.index}][ERROR] 请求发起失败!${e}\n`);
            }
        }
    }
    //自动续期
    async upDateToken() {
        try {
            const opts = {
                url: "/auth/refresh/token",
                body: { "token": this.token.split("bearer ")[1] }
            }
            let res = await this.fetch(opts);
            $.info($.toStr(res));
            if (!res?.data?.token) throw new Error(res?.message);
            const index = userCookie.findIndex(e => e.userId == this.userId);
            if (userCookie[index]) userCookie[index].token = "bearer " + res?.data?.token;
            // 续期更新存储(四端): 手机端写持久化存储; Node(青龙)写 box.dat, 青龙 env 建议手动同步
            $.setjson(userCookie, ckName);
            $.info(`[${this.userName}] 续期:${res?.message}`);
            this.headers['Authorization'] = "bearer " + res?.data?.token;
            this.token = "bearer " + res?.data?.token;
        } catch (e) {
            this.ckStatus = false;
            $.error(`[${this.userName || this.userId}] 错误！${e}`);
        }
    }
    //签到接口
    async signin() {
        try {
            let res = await this.fetch({ url: "/sign/new/do" });
            if (res?.code == "500") throw new Error(res?.message);
            $.info(`[${this.userName}] 签到:${res?.message || "签到成功"}`);
        } catch (e) {
            this.ckStatus = false;
            $.error(`[${this.userName || this.userId}] 错误！${e}`);
        }
    }
    //步数兑换接口
    async step() {
        try {
            const opts = {
                url: "/step/exchange",
                body: { "steps": 1720 }
            }
            let res = await this.fetch(opts);
            if (res?.code == "500") throw new Error(res?.message);
            $.info(`[${this.userName}] 步数:${res?.message}`);
            return res?.message.match(/每天最多兑换3次/);
        } catch (e) {
            this.ckStatus = false;
            $.error(`[${this.userName || this.userId}] 错误！${e}`);
        }
    }
    async alipayTask() {
        let taskList = [
            { "name": "爱心林浇水", "taskId": 20 },
            { "name": "去公益林浇水", "taskId": 32 },
            { "name": "去支付宝搜\"飞蚂蚁\"", "taskId": 49 },
            { "name": "飞蚂蚁VIP会员卡", "taskId": 19 },
        ]
        for (let task of taskList) {
            await this.doTask(task);
        }
    }
    //完成任务
    async doTask(task) {
        try {
            const opts = {
                url: "/home/send-task-beans",
                body: {
                    "version": "V2.00.01",
                    "mini_scene": "1005",
                    "taskId": task?.taskId || task,
                    "platformKey": TASK_PLATFORM_KEY
                }

            }
            let res = await this.fetch(opts);
            if (res?.code == "500") throw new Error(res?.message);
            $.info(`[${this.userName}] ${task?.name || task}:${res?.message}`);
            if (res?.message.match(/奖励信息/)) return task;
        } catch (e) {
            this.ckStatus = false;
            $.error(`[${this.userName || this.userId}] 错误！${e}`);
        }
    }
    //报名打卡接口
    async bet() {
        try {
            let res = await this.fetch({ url: "/active/pool/bet" });
            if (res?.code == "500") throw new Error(res?.message);
            $.info(`[${this.userName}] 报名:${res?.message}`);
        } catch (e) {
            this.ckStatus = false;
            $.error(`[${this.userName || this.userId}] 错误！${e}`);
        }
    }
    //打卡签到接口
    async poolSign() {
        try {
            let res = await this.fetch({ url: "/active/pool/sign" });
            if (res?.code == "500") throw new Error(res?.message);
            $.info(`[${this.userName}] 打卡:${res?.message}`);
        } catch (e) {
            this.ckStatus = false;
            $.error(`[${this.userName || this.userId}] 错误！${e}`);
        }
    }

    // 转盘奖品查询 (GET active/turntable/info?active_id=1 -> data.data.prizeList)
    async turntableInfo() {
        try {
            const res = await this.fetch({ url: "/active/turntable/info?active_id=1&type=1", type: "get" });
            const prizeList = res?.data?.data?.prizeList || res?.data?.prizeList || res?.data?.data || [];
            if (!Array.isArray(prizeList) || !prizeList.length) {
                $.info(`[${this.userName}] 转盘奖品: ${res?.message || '无数据'}`);
                return;
            }
            const rows = prizeList.map((it, i) => {
                const n = it.prizeName || it.name || it.prize || it.goodsName || it.grant_name || it.prize_info?.name;
                const v = it.prizeValue ?? it.value ?? it.integral ?? it.amount ?? it.grant_value ?? it.prize_info?.value;
                return `${i+1}.${n||`奖品${it.id??''}`}${v!=null?`(${v})`:''}`;
            }).join(' | ');
            $.info(`[${this.userName}] 转盘奖品: ${rows}`);
        } catch (e) {
            $.log(`[${this.userName}] 转盘奖品查询: ${e}`);
        }
    }

    //抽奖接口 (转盘, 受 fmy_draw 存储键控制, 默认关闭)
    async draw() {
        try {
            const on = /^(true|1|yes|on)$/i.test(String($.getdata('fmy_draw')||''));
            if(!on){ $.log(`[${this.userName}] 转盘抽奖: 未开启(开关 fmy_draw 默认关)`); return; }
            const opts = {
                url: "/active/turntable/go?active_id=1&type=1",
                type: "get"
            }
            let res = await this.fetch(opts);
            if (res?.code == "500") throw new Error(res?.message);
            $.info(`[${this.userName}] 抽奖:${res?.data?.prizeName || res?.message || '无响应'}`);
        } catch (e) {
            this.ckStatus = false;
            $.error(`[${this.userName || this.userId}] 错误！${e}`);
        }
    }
    async getBean() {
        try {
            let getCount = await this.bean(1);
            let useCount = await this.bean(2);
            let total = getCount - 0 - useCount
            if(!total) throw new Error("登录已过期");
            $.info(`[${this.userName}] 余额:${total}`)
            return total;
        } catch (e) {
            this.ckStatus = false;
            $.error(`[${this.userName || this.userId}] 错误！${e}`);
        }
    }
    //查询豆子
    async bean(type) {
        try {
            const opts = {
                url: `https://openapp.fmy90.com/user/new/beans/info?type=${type}&version=V2.00.01&platformKey=${this.platformKey}&mini_scene=1089&partner_ext_infos=`,
                type: "get"
            }
            let res = await this.fetch(opts);
            if (res?.code == "500") throw new Error(res?.message);
            return res?.data?.totalCount;
        } catch (e) {
            this.ckStatus = false;
            $.error(`[${this.userName || this.userId}] 签到错误！${e}`);
        }
    }

    // B端专属: 答题红包(answer-invite)
    async answerInvite() {
        const acID = 3; 
        const base = "/answer-invite";
        const gf = (p) => this.fetch({ url: `${base}/${p}${/\?/.test(p) ? '&' : '?'}activityId=${acID}`, type: "get" });
        const pf = (p, b) => this.fetch({ url: `${base}/${p}`, body: { "activity_id": acID, ...b } });
        try {
            let isAnswered = "0";
            const info = await gf("user-info");
            if (info?.code == 200) isAnswered = String(info?.data?.answer_user?.is_answered ?? "0");

            let completed = 0;
            try {
                const tl = await gf("task-list");
                const tasks = tl?.data || tl || [];
                if (Array.isArray(tasks)) {
                    for (const t of tasks) {
                        if (String(t.is_complete) === "1") continue;
                        const tid = t.id;
                        if (tid == null) continue;
                        const sign = String(t.sign || '');
                        if (/COLLECT_MINI_PROGRAM|FOLLOW_EWX|ADD_EWX|COLLECT|FOLLOW|ADD/.test(sign)) continue;
                        const ct = await pf("complete-task", { "task_id": tid });
                        if (ct?.data?.reward_log?.id) completed++;
                        await sdelay(1000, 2500);
                    }
                }
            } catch (e) {}

            await pf("bind", { "answer_invite_share_key": "", "config_id": acID });

            let hadAnswer = String(isAnswered) === "1";
            if (!hadAnswer) {
                await pf("send-self-answer-reward", {});
            }

            let opened = 0, totalAmt = 0;
            try {
                const rl = await gf("user-reward-list?page=1&pageSize=20");
                const pag = rl?.data?.data || {};
                const rew = Array.isArray(pag) ? pag : (pag.data || rl?.data?.list || rl?.data || []);
                if (Array.isArray(rew)) {
                    for (const r of rew) {
                        if (String(r.status) !== "0") continue;
                        if (r.id == null) continue;
                        const open = await pf("open-red-reward", { "reward_id": r.id });
                        const amt = open?.data?.amount ?? r.amount;
                        if (amt != null) { opened++; totalAmt += Number(amt); }
                        await sdelay(1000, 2500);
                    }
                }
            } catch (e) {}
            if (opened) $.info(`[${this.userName}] 答题红包: 领取 ${opened} 个红包, +${(totalAmt/100).toFixed(2)}元 ✅`);
        } catch (e) {
            $.error(`[${this.userName || this.userId}] 答题红包错误: ${e}`);
        }
    }
}

// 获取Cookie (四端抓包双模式 - 已修复A/B端相互覆盖Bug)
async function getCookie() {
    try {
        let endKey = 'A';
        try {
            const reqUrl = ($request && ($request.url || $request.URL)) || '';
            const pm = reqUrl.match(/platformKey=([A-Za-z0-9]{20,})/i);
            if (pm) {
                if (pm[1] === APP_LIST.B.platformKey) endKey = 'B';
                else if (pm[1] === APP_LIST.A.platformKey) endKey = 'A';
            } else {
                const referer = ($request && $request.headers && ($request.headers.Referer || $request.headers.referer)) || '';
                const m = referer.match(/servicewechat\.com\/(wx[0-9a-fA-F]{16})/);
                if (m) { if (m[1] === APP_LIST.B.appId) endKey = 'B'; else if (m[1] === APP_LIST.A.appId) endKey = 'A'; }
            }
        } catch(_e) {}

        let token='', userId='', userName='';
        if (typeof $response !== 'undefined' && $response && $response.body) {
            const Body = $.toObj($response.body);
            if (Body && Body.data && Body.data.token) {
                token = "bearer " + Body.data.token;
                userId = String((Body.data.user && Body.data.user.userId) || '');
                userName = String((Body.data.user && (Body.data.user.userPhone||Body.data.user.phone||Body.data.user.mobile)) || '');
            }
        } else if ($request && $request.headers) {
            token = String($request.headers.Authorization || $request.headers.authorization || '').trim();
            if (token && !/^bearer\s/i.test(token) && /^\S/.test(token)) token = "bearer " + token;
        }
        if (!token) return;

        let acc = null;
        if (userId) {
            acc = userCookie.find(e => String(e.userId) === String(userId));
        }
        if (!acc) {
            acc = userCookie.find(e => (e.A && e.A.token === token) || (e.B && e.B.token === token) || (e.token === token));
        }
        if (!acc && userCookie.length > 0) {
            const lastAcc = userCookie[userCookie.length - 1];
            if (!lastAcc[endKey] || !lastAcc[endKey].token) {
                acc = lastAcc;
            }
        }
        if (!acc) {
            acc = { userId: userId || '', userName: '', A: {}, B: {} };
            userCookie.push(acc);
        }

        if (userId) acc.userId = userId;
        if (userName) acc.userName = acc.userName || userName;
        if (!acc.A) acc.A = {};
        if (!acc.B) acc.B = {};
        
        // 关键：独立写入对应端，A和B互不影响，彻底解决覆盖问题
        acc[endKey] = { token };

        $.setjson(userCookie, ckName);
        const uname = maskString(userName || (userId ? userId : token.replace(/^bearer\s/i,'')) || endKey);
        $.msg($.name, `🎉账号[${uname}]更新 ${APP_LIST[endKey].label} token成功!`, ``);
    } catch (e) {
        $.log(`抓包失败: ${e && e.message ? e.message : e}`);
    }
}

// ===== 远端通知 =====
let sanCache=0; let sanNotices='';
function fetchJson(u){
  return new Promise((resolve,reject)=>{
    const done=(j)=>resolve(j);
    if(typeof $httpClient!=='undefined'){ $httpClient.get(u,(err,resp,body)=>{ if(err||!body)return reject(); try{done(JSON.parse(body));}catch(e){reject();} }); }
    else if(typeof $task!=='undefined'){ $task.fetch({url:u,timeout:15000}).then(r=>{ try{done(JSON.parse(r.body));}catch(e){reject();} },()=>reject()); }
    else if(typeof fetch==='function'){ fetch(u).then(r=>r.json()).then(done,reject); }
    else reject();
  });
}
function printDisclaimer(){
  return new Promise((resolve)=>{
    try{
      if(sanNotices && Date.now()-sanCache<30*60*1000){ $.log(sanNotices); resolve(); return; }
      const urls=[
        'https://cdn.jsdelivr.net/gh/kwypn/Hi@main/notice.json',
        'https://cdn.jsdelivr.net/gh/kwypn/Hi@main/tip.json'
      ];
      Promise.all(urls.map(u=>fetchJson(u).catch(()=>null))).then((res)=>{
        const lines=[];
        for(const j of res){ if(j && (j.notice||j.tip||j.msg||j.message)) lines.push(j.notice||j.tip||j.msg||j.message); }
        if(lines.length){ sanNotices=lines.join('\n'); sanCache=Date.now(); $.log(sanNotices); }
        resolve();
      }).catch(()=>resolve());
    }catch(_e){ resolve(); }
  });
}

//主程序执行入口
!(async () => {
    try {
        if (typeof $request != "undefined") {
            await getCookie();
        } else {
            await printDisclaimer();
            await checkEnv();
            await main();
        }
    } catch (e) {
        throw e;
    }
})()
    .catch((e) => { $.logErr(e), $.msg($.name, `⛔️ script run error!`, e.message || e) })
    .finally(async () => {
        $.done({});
    });

/** ---------------------------------固定不动区域----------------------------------------- */
//prettier-ignore
async function sendMsg(a, e) { a && ($.isNode() ? await notify.sendNotify($.name, a) : $.msg($.name, $.title || "", a, e)) }
function DoubleLog(o) { o && ($.log(`${o}`), $.notifyMsg.push(`${o}`)) };
async function checkEnv() { try { if (!userCookie?.length) throw new Error("no available accounts found"); const list=[]; for(const o of userCookie){ 
    const hasA = !!((o && o.A && o.A.token) || (o && o.token)); const hasB = !!(o && o.B && o.B.token);
    if(hasA) list.push(new UserInfo(o,'A')); if(hasB) list.push(new UserInfo(o,'B')); } $.log(`\n[INFO] 检测到 ${userCookie?.length ?? 0} 个账号, 待执行 ${list.length} 端次\n`), $.userList.push(...list) } catch (o) { throw o } }
function debug(g, e = "debug") { $.is_debug && ($.log(`\n-----------${e}------------\n`), $.log("string" == typeof g ? g : $.toStr(g) || `debug error => t=${g}`), $.log(`\n-----------${e}------------\n`)) }
function ObjectKeys2LowerCase(obj) { return !obj ? {} : Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v])) };
async function Request(t) { "string" == typeof t && (t = { url: t }); try { if (!t?.url) throw new Error("[URL][ERROR] 缺少 url 参数"); let { url: o, type: e, headers: r = {}, body: , params: a, dataType: n = "form", resultType: u = "data" } = t; const p = e ? e?.toLowerCase() : "body" in t ? "post" : "get", c = o.concat("post" === p ? "?" + $.queryStr(a) : ""), i = t.timeout ? $.isSurge() ? t.timeout / 1e3 : t.timeout : 1e4; "json" === n && (r["Content-Type"] = "application/json;charset=UTF-8"); const y = "string" == typeof  ?  : ( && "form" == n ? $.queryStr() : $.toStr()), l = { ...t, ...t?.opts ? t.opts : {}, url: c, headers: r, ..."post" === p && { body: y }, ..."get" === p && a && { params: a }, timeout: i }, m = $.http[p.toLowerCase()](l).then((t => "data" == u ? $.toObj(t.body) || t.body : $.toObj(t) || t)).catch((t => $.log(`[${p.toUpperCase()}][ERROR] ${t}\n`))); return Promise.race([new Promise(((t, o) => setTimeout((() => o("当前请求已超时")), i))), m]) } catch (t) { console.log(`[${p.toUpperCase()}][ERROR] ${t}\n`) } }
function Env(t, e) { class s { constructor(t) { this.env = t } send(t, e = "GET") { t = "string" == typeof t ? { url: t } : t; let s = this.get; return "POST" === e && (s = this.post), new Promise(((e, i) => { s.call(this, t, ((t, s, o) => { t ? i(t) : e(s) })) })) } get(t) { return this.send.call(this.env, t) } post(t) { return this.send.call(this.env, t, "POST") } } return new class { constructor(t, e) { this.logLevels = { debug: 0, info: 1, warn: 2, error: 3 }, this.logLevelPrefixs = { debug: "[DEBUG] ", info: "[INFO] ", warn: "[WARN] ", error: "[ERROR] " }, this.logLevel = "info", this.name = t, this.http = new s(this), this.data = null, this.dataFile = "box.dat", this.logs = [], this.isMute = !1, this.isNeedRewrite = !1, this.logSeparator = "\n", this.encoding = "utf-8", this.startTime = (new Date).getTime(), Object.assign(this, e), this.log("", `🔔${this.name}, 开始!`) } getEnv() { return "undefined" != typeof $environment && $environment["surge-version"] ? "Surge" : "undefined" != typeof $environment && $environment["stash-version"] ? "Stash" : "undefined" != typeof module && module.exports ? "Node.js" : "undefined" != typeof $task ? "Quantumult X" : "undefined" != typeof $loon ? "Loon" : "undefined" != typeof $rocket ? "Shadowrocket" : void 0 } isNode() { return "Node.js" === this.getEnv() } isQuanX() { return "Quantumult X" === this.getEnv() } isSurge() { return "Surge" === this.getEnv() } isLoon() { return "Loon" === this.getEnv() } isShadowrocket() { return "Shadowrocket" === this.getEnv() } isStash() { return "Stash" === this.getEnv() } toObj(t, e = null) { try { return JSON.parse(t) } catch(_){ return e } } toStr(t, e = null, ...s) { try { return JSON.stringify(t, ...s) } catch(_){ return e } } getjson(t, e) { let s = e; if (this.getdata(t)) try { s = JSON.parse(this.getdata(t)) } catch(_){ } return s } setjson(t, e) { try { return this.setdata(JSON.stringify(t), e) } catch(_){ return !1 } } getScript(t) { return new Promise((e => { this.get({ url: t }, ((t, s, i) => e(i))) })) } runScript(t, e) { return new Promise((s => { let i = this.getdata("@chavy_boxjs_userCfgs.httpapi"); i = i ? i.replace(/\n/g, "").trim() : i; let o = this.getdata("@chavy_boxjs_userCfgs.httpapi_timeout"); o = o ? 1 * o : 20, o = e && e.timeout ? e.timeout : o; const [r, a] = i.split("@"), n = { url: `http://${a}/v1/scripting/evaluate`, body: { script_text: t, mock_type: "cron", timeout: o }, headers: { "X-Key": r, Accept: "*/*" }, timeout: o }; this.post(n, ((t, e, i) => s(i))) })) .catch((t => this.logErr(t))) } loaddata() { if (!this.isNode()) return {}; { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), i = !s && this.fs.existsSync(e); if (!s && !i) return {}; { const i = s ? t : e; try { return JSON.parse(this.fs.readFileSync(i)) } catch (t) { return {} } } } } writedata() { if (this.isNode()) { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), i = !s && this.fs.existsSync(e), o = JSON.stringify(this.data); s ? this.fs.writeFileSync(t, o) : i ? this.fs.writeFileSync(e, o) : this.fs.writeFileSync(t, o) } } lodash_get(t, e, s) { const i = e.replace(/\[(\d+)\]/g, ".$1").split("."); let o = t; for (const t of i) if (o = Object(o)[t], void 0 === o) return s; return o } lodash_set(t, e, s) { return Object(t) !== t || (Array.isArray(e) || (e = e.toString().match(/[^.[\]]+/g) || []), e.slice(0, -1).reduce(((t, s, i) => Object(t[s]) === t[s] ? t[s] : t[s] = Math.abs(e[i + 1]) >> 0 == +e[i + 1] ? [] : {}), t)[e[e.length - 1]] = s), t } getdata(t) { let e = this.getval(t); if (/^@/.test(t)) { const [, s, i] = /^@(.*?)\.(.*?)$/.exec(t), o = s ? this.getval(s) : ""; if (o) try { const t = JSON.parse(o); e = t ? this.lodash_get(t, i, "") : e } catch (t) { e = "" } } return e } setdata(t, e) { let s = !1; if (/^@/.test(e)) { const [, i, o] = /^@(.*?)\.(.*?)$/.exec(e), r = this.getval(i), a = i ? "null" === r ? null : r || "{}" : "{}"; try { const e = JSON.parse(a); this.lodash_set(e, o, t), s = this.setval(JSON.stringify(e), i) } catch (e) { const r = {}; this.lodash_set(r, o, t), s = this.setval(JSON.stringify(r), i) } } else s = this.setval(t, e); return s } getval(t) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.read(t); case "Quantumult X": return $prefs.valueForKey(t); case "Node.js": return this.data = this.loaddata(), this.data[t]; default: return this.data && this.data[t] || null } } setval(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.write(t, e); case "Quantumult X": return $prefs.setValueForKey(t, e); case "Node.js": return this.data = this.loaddata(), this.data[e] = t, this.writedata(), !0; default: return this.data && this.data[e] || null } } initGotEnv(t) { this.got = this.got ? this.got : require("got"), this.cktough = this.cktough ? this.cktough : require("tough-cookie"), this.ckjar = this.ckjar ? this.ckjar : new this.cktough.CookieJar, t && (t.headers = t.headers ? t.headers : {}, t && (t.headers = t.headers ? t.headers : {}, void 0 === t.headers.cookie && void 0 === t.headers.Cookie && void 0 === t.cookieJar && (t.cookieJar = this.ckjar))) } get(t, e = (() => { })) { switch (t.headers && (delete t.headers["Content-Type"], delete t.headers["Content-Length"], delete t.headers["content-type"], delete t.headers["content-length"]), t.params && (t.url += "?" + this.queryStr(t.params)), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient.get(t, ((t, s, i) => { !t && s && (s.body = i, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, i) })); break; case "Quantumult X": this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: i, headers: o, body: r, bodyBytes: a } = t; e(null, { status: s, statusCode: i, headers: o, body: r, bodyBytes: a }, r, a) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let s = require("iconv-lite"); this.initGotEnv(t), this.got(t).on("redirect", ((t, e) => { try { if (t.headers["set-cookie"]) { const s = t.headers["set-cookie"].map(this.cktough.Cookie.parse).toString(); s && this.ckjar.setCookieSync(s, null), e.cookieJar = this.ckjar } } catch (t) { this.logErr(t) } })).then((t => { const { statusCode: i, statusCode: o, headers: r, rawBody: a } = t, n = s.decode(a, this.encoding); e(null, { status: i, statusCode: o, headers: r, rawBody: a, body: n }, n) }), (t => { const { message: i, response: o } = t; e(i, o, o && s.decode(o.rawBody, this.encoding)) })); break } } post(t, e = (() => { })) { const s = t.method ? t.method.toLocaleLowerCase() : "post"; switch (t.body && t.headers && !t.headers["Content-Type"] && !t.headers["content-type"] && (t.headers["content-type"] = "application/x-www-form-urlencoded"), t.headers && (delete t.headers["Content-Length"], delete t.headers["content-length"]), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient[s](t, ((t, s, i) => { !t && s && (s.body = i, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, i) })); break; case "Quantumult X": t.method = s, this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: i, headers: o, body: r, bodyBytes: a } = t; e(null, { status: s, statusCode: i, headers: o, body: r, bodyBytes: a }, r, a) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let i = require("iconv-lite"); this.initGotEnv(t); const { url: o, ...r } = t; this.got[s](o, r).then((t => { const { statusCode: s, statusCode: o, headers: r, rawBody: a } = t, n = i.decode(a, this.encoding); e(null, { status: s, statusCode: o, headers: r, rawBody: a, body: n }, n) }), (t => { const { message: s, response: o } = t; e(s, o, o && i.decode(o.rawBody, this.encoding)) })); break } } time(t, e = null) { const s = e ? new Date(e) : new Date; let i = { "M+": s.getMonth() + 1, "d+": s.getDate(), "H+": s.getHours(), "m+": s.getMinutes(), "s+": s.getSeconds(), "q+": Math.floor((s.getMonth() + 3) / 3), S: s.getMilliseconds() }; /(y+)/.test(t) && (t = t.replace(RegExp.$1, (s.getFullYear() + "").substr(4 - RegExp.$1.length))); for (let e in i) new RegExp("(" + e + ")").test(t) && (t = t.replace(RegExp.$1, 1 == RegExp.$1.length ? i[e] : ("00" + i[e]).substr(("" + i[e]).length))); return t } queryStr(t) { let e = ""; for (const s in t) { let i = t[s]; null != i && "" !== i && ("object" == typeof i && (i = JSON.stringify(i)), e += `${s}=${i}&`) } return e = e.substring(0, e.length - 1), e } msg(e = t, s = "", i = "", o = {}) { const r = t => { const { $open: e, $copy: s, $media: i, $mediaMime: o } = t; switch (typeof t) { case void 0: return t; case "string": switch (this.getEnv()) { case "Surge": case "Stash": default: return { url: t }; case "Loon": case "Shadowrocket": return t; case "Quantumult X": return { "open-url": t }; case "Node.js": return }case "object": switch (this.getEnv()) { case "Surge": case "Stash": case "Shadowrocket": default: { const r = {}; let a = t.openUrl || t.url || t["open-url"] || e; a && Object.assign(r, { action: "open-url", url: a }); let n = t["update-pasteboard"] || t.updatePasteboard || s; if (n && Object.assign(r, { action: "clipboard", text: n }), i) { let t, e, s; if (i.startsWith("http")) t = i; else if (i.startsWith("data:")) { const [t] = i.split(";"), [, o] = i.split(","); e = o, s = t.replace("data:", "") } else { e = i, s = (t => { const e = { JVBERi0: "application/pdf", R0lGODdh: "image/gif", R0lGODlh: "image/gif", iVBORw0KGgo: "image/png", "/9j/": "image/jpg" }; for (var s in e) if (0 === t.indexOf(s)) return e[s]; return null })(i) } Object.assign(r, { "media-url": t, "media-base64": e, "media-base64-mime": o ?? s }) } return Object.assign(r, { "auto-dismiss": t["auto-dismiss"], sound: t.sound }), r } case "Loon": { const s = {}; let o = t.openUrl || t.url || t["open-url"] || e; o && Object.assign(s, { openUrl: o }); let r = t.mediaUrl || t["media-url"]; return i?.startsWith("http") && (r = i), r && Object.assign(s, { mediaUrl: r }), console.log(JSON.stringify(s)), s } case "Quantumult X": { const o = {}; let r = t["open-url"] || t.url || t.openUrl || e; r && Object.assign(o, { "open-url": r }); let a = t["media-url"] || t.mediaUrl; i?.startsWith("http") && (a = i), a && Object.assign(o, { "media-url": a }); let n = t["update-pasteboard"] || t.updatePasteboard || ; return n && Object.assign(o, { "update-pasteboard": n }), console.log(JSON.stringify(o)), o } case "Node.js": return }default: return } }; if (!this.isMute) switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: $notification.post(e, , i, r(o)); break; case "Quantumult X": $notify(e, , i, r(o)); break; case "Node.js": break }if (!this.isMuteLog) { let t = ["", "==============📣系统通知📣=============="]; t.push(e),  && t.push(), i && t.push(i), console.log(t.join("\n")), this.logs = this.logs.concat(t) } } debug(...t) { this.logLevels[this.logLevel] <= this.logLevels.debug && (t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(`${this.logLevelPrefixs.debug}${t.map((t => t ?? String(t))).join(this.logSeparator)}`)) } info(...t) { this.logLevels[this.logLevel] <= this.logLevels.info && (t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(`${this.logLevelPrefixs.info}${t.map((t => t ?? String(t))).join(this.logSeparator)}`)) } warn(...t) { this.logLevels[this.logLevel] <= this.logLevels.warn && (t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(`${this.logLevelPrefixs.warn}${t.map((t => t ?? String(t))).join(this.logSeparator)}`)) } error(...t) { this.logLevels[this.logLevel] <= this.logLevels.error && (t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(`${this.logLevelPrefixs.error}${t.map((t => t ?? String(t))).join(this.logSeparator)}`)) } log(...t) { t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(t.map((t => t ?? String(t))).join(this.logSeparator)) } logErr(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: this.log("", `❗️${this.name}, 错误!`, e, t); break; case "Node.js": this.log("", `❗️${this.name}, 错误!`, e, void 0 !== t.message ? t.message : t, t.stack); break } } wait(t) { return new Promise((e => setTimeout(e, t))) } done(t = {}) { const e = ((new Date).getTime() - this.startTime) / 1e3; switch (this.log("", `🔔${this.name}, 结束! 🕛 ${e} 秒`), this.log(), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: $done(t); break; case "Node.js": process.exit(1) } } }(t, e) }
