// CSS Modules have no layout role in Node's server-rendered unit assertions.
require.extensions['.css'] = (module) => { module.exports = {__esModule:true,default:new Proxy({}, {get:(_target,key)=>String(key)})}; };
