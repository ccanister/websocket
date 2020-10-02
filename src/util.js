const crypto = require("crypto");
const MAGIC_KEY = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const mask_length = 4;
const seg_length = 270;

function generateAcceptValue(secWsKey) {
  return crypto
    .createHash("sha1")
    .update(secWsKey + MAGIC_KEY, "utf8")
    .digest("base64");
}

class Msg {
  constructor(buffer) {
    this.loadData = 0;
    this.buffers = [];
    this.parse(buffer);
    this.finished = this.isFinish(buffer);
  }

  parse(buffer) {
    const buffers = this.buffers;
    if (buffers.length === 0) {
      buffers.push(buffer);
      const offset = this.parseLengthAndMask(buffer);
      this.origin = new Uint8Array(this.length);
      const length = Math.min(buffer.length - offset, this.length);
      this.readMaskData(buffer, offset, length);
      this.loadData += length;
    } else {
      this.readMaskData(buffer, 0, buffer.length);
      this.loadData += buffer.length;
    }
  }

  left() {
    return this.length - this.loadData;
  }

  isFinish(buffer) {
    return Boolean((buffer.readUInt8(0) >>> 7) & 0x01);
  }

  readMaskData(buffer, offset, length) {
    const { origin, loadData } = this;
    for (let i = 0; i < length; i++) {
      origin[i + loadData] = toSuffixHexAdecimal(buffer.readUInt8(i + offset));
    }

    return origin;
  }

  parseLengthAndMask(buffer) {
    const masks = buffer.readUInt8(1).toString(2);
    const isMask = masks.slice(0, 1);
    let length = parseInt(masks.slice(1), 2);
    let offset = 2;
    if (length === 126) {
      length = parseInt(buffer.readUInt16BE(2).toString(16), 16);
      offset += 2;
    } else if (length === 127) {
      length = parseInt(
        buffer.readUInt32BE(2).toString(16) +
          buffer.readUInt32BE(6).toString(16),
        16
      );
      offset += 8;
    }
    this.length = length;
    if (isMask) {
      const maskKey = new Uint8Array(mask_length); // 初始化长度
      for (let i = 0; i < mask_length; i++) {
        maskKey[i] = toSuffixHexAdecimal(buffer.readUInt8(i + offset)); // 标志为16进制
      }
      this.maskKey = maskKey;
      offset += mask_length;
    }

    return offset;
  }

  maskOp() {
    const { maskKey, origin } = this;
    const result = new Uint8Array(origin.length);
    for (let i = 0, j = 0; i < origin.length; i++, j = i % 4) {
      result[i] = origin[i] ^ maskKey[j];
    }
    return result;
  }
}

function decode(datas) {
  const total = datas.reduce((total, cur) => total + cur.length, 0);
  const segs = Math.ceil(total / seg_length); // 分片长度
  let seg = 0,
    segDataIdx = 0, // 指向当前data的索引
    dataIdx = 0,
    data = datas[seg];
  const result = [];
  while (seg < segs) {
    const length = seg === segs - 1 ? total - seg_length * seg : seg_length;
    const arr = new Uint8Array(length);
    result.push(arr);
    seg++;
    for (let arrIdx = 0; arrIdx < length; arrIdx++) {
      if (segDataIdx === data.length) { // 当前data读取完毕
        segDataIdx = 0;
        data = datas[++dataIdx];
      }
      arr[arrIdx] = data[segDataIdx++];
    }
  }
  return result.reduce(
    (str, data) =>
      (str += decodeURI(
        Array.from(data)
          .map((r) => "%" + toHexAdecimal(r))
          .join("")
      )),
    ""
  );
}

function toHexAdecimal(num) {
  return Number(num).toString(16);
}

const OPCODES = {
  CONTINUE: 0,
  TEXT: 1,
  BINARY: 2,
  CLOSE: 8,
};

let msgs = [];
function parseMessage(buffer) {
  if (msgs.length > 0) {
    const msg = msgs[msgs.length - 1];
    const left = msg.left();
    if (left > 0) {
      msg.parse(buffer.slice(0, left));
      if (left >= buffer.length) {
        return;
      } else {
        buffer = buffer.slice(left);
      }
    }
  }
  const op = buffer.readUInt8(0) & 0x0f;
  console.log(`op: ${op}`);
  let msg;
  switch (op) {
    case OPCODES.TEXT:
      msg = new Msg(buffer);
      if (msg.finished) {
        console.log(`收到信息：${decode([msg.maskOp()])}`);
      } else {
        msgs.push(msg);
      }
      break;
    case OPCODES.CONTINUE:
      msg = new Msg(buffer);
      msgs.push(msg);
      if (msg.finished) {
        const datas = msgs.map((m) => m.maskOp());
        console.log(`收到信息：${decode(datas)}`);
        msgs = [];
      }
      break;
    case OPCODES.BINARY:
      // 暂不处理二进制流
      break;
    case OPCODES.CLOSE:
      console.log("websocket关闭连接");
      break;
    default:
      throw new Error("未知的操作码");
  }
}

function log(data) {
  return Array.from(data)
    .map((code) => toHexAdecimal(code))
    .join(",");
}

// 只处理长度小于125的字符串
function send(data) {
  const b1 = toSuffixHexAdecimal(0x80 | OPCODES.TEXT);
  const payLoad = Buffer.from(data, "utf8");
  const length = payLoad.length;
  const b2 = toSuffixHexAdecimal(length);
  const buffer = Buffer.alloc(length + 2);
  buffer.writeUInt8(b1, 0);
  buffer.writeUInt8(b2, 1);
  payLoad.copy(buffer, 2);
  return buffer;
}

function toSuffixHexAdecimal(num) {
  return "0x" + toHexAdecimal(num);
}

function close() {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt8(toSuffixHexAdecimal(0x80 | OPCODES.CLOSE));
  buffer.writeUInt8(toSuffixHexAdecimal(0), 1);
  return buffer;
}

module.exports = { generateAcceptValue, parseMessage, log, send, close };
