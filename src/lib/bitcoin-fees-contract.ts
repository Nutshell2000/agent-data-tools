const nonnegative = {type:"number",minimum:0};
export const BITCOIN_FEES_OUTPUT_SCHEMA = {
  type:"object",required:["network","unit","fees","typicalPaymentSats","typicalPaymentVbytes","source","limitations","mempool","blockHeight","checkedAt"],
  properties:{
    network:{const:"bitcoin"},unit:{const:"sat/vB"},
    fees:{type:"object",required:["nextBlock","halfHour","hour","economy","minimum"],properties:{nextBlock:nonnegative,halfHour:nonnegative,hour:nonnegative,economy:nonnegative,minimum:nonnegative}},
    typicalPaymentSats:{type:"object",required:["nextBlock","hour"],properties:{nextBlock:nonnegative,hour:nonnegative}},
    typicalPaymentVbytes:{const:141,description:"Illustrative transaction-size assumption; not the buyer's transaction size."},
    source:{const:"https://mempool.space/api"},limitations:{type:"array",minItems:1,items:{type:"string"}},
    mempool:{type:"object",required:["transactions","vsize","totalFeesBtc"],properties:{transactions:{type:"integer",minimum:0},vsize:{type:"integer",minimum:0},totalFeesBtc:nonnegative}},
    blockHeight:{type:"integer",minimum:0},checkedAt:{type:"string",description:"Server retrieval time in UTC. Upstream endpoints are not an atomic snapshot."},
  }
};
