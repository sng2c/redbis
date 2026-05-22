import { HandlerContext, CommandFn } from '../context';
import {
  encodeSimpleString,
  encodeError,
  encodeInteger,
  encodeBulkString,
  encodeArray,
} from '../../protocol/resp';

export function registerGeoCommands(registry: Map<string, CommandFn>): void {
  registry.set('GEOADD', handleGeoadd);
  registry.set('GEOHASH', handleGeohash);
  registry.set('GEOPOS', handleGeopos);
  registry.set('GEODIST', handleGeodist);
  registry.set('GEORADIUS', handleGeoradius);
  registry.set('GEORADIUSBYMEMBER', handleGeoradiusbymember);
  registry.set('GEOSEARCH', handleGeosearch);
  registry.set('GEOSEARCHSTORE', handleGeosearchstore);
  registry.set('GEORADIUS_RO', handleGeoradiusRo);
  registry.set('GEORADIUSBYMEMBER_RO', handleGeoradiusbymemberRo);
}

async function handleGeoadd(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 4) {
    return encodeError("wrong number of arguments for 'GEOADD' command");
  }
  const key = args[0];
  let nx = false, xx = false, ch = false;
  let i = 1;
  // Parse optional flags
  while (i < args.length) {
    const opt = args[i].toUpperCase();
    if (opt === 'NX') { nx = true; i++; }
    else if (opt === 'XX') { xx = true; i++; }
    else if (opt === 'CH') { ch = true; i++; }
    else break;
  }
  // Remaining args: longitude latitude member triplets
  const remaining = args.length - i;
  if (remaining < 3 || remaining % 3 !== 0) {
    return encodeError("wrong number of arguments for 'GEOADD' command");
  }
  const members: Array<{ longitude: number; latitude: number; member: string }> = [];
  for (let j = i; j < args.length; j += 3) {
    const longitude = parseFloat(args[j]);
    const latitude = parseFloat(args[j + 1]);
    if (isNaN(longitude) || isNaN(latitude)) {
      return encodeError('ERR value is not a valid float');
    }
    if (longitude < -180 || longitude > 180) {
      return encodeError('ERR invalid longitude, valid range is [-180, 180]');
    }
    if (latitude < -85.05112878 || latitude > 85.05112878) {
      return encodeError('ERR invalid latitude, valid range is [-85.05112878, 85.05112878]');
    }
    members.push({ longitude, latitude, member: args[j + 2] });
  }
  const options: { nx?: boolean; xx?: boolean; ch?: boolean } = {};
  if (nx) options.nx = true;
  if (xx) options.xx = true;
  if (ch) options.ch = true;
  const result = await ctx.storage.geoadd(key, members, options);
  return encodeInteger(result);
}

async function handleGeohash(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) {
    return encodeError("wrong number of arguments for 'GEOHASH' command");
  }
  const key = args[0];
  const members = args.slice(1);
  const result = await ctx.storage.geohash(key, members);
  const parts = result.map(r => r === null ? encodeBulkString(null) : encodeBulkString(r));
  return `*${parts.length}\r\n${parts.join('')}`;
}

async function handleGeopos(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) {
    return encodeError("wrong number of arguments for 'GEOPOS' command");
  }
  const key = args[0];
  const members = args.slice(1);
  const result = await ctx.storage.geopos(key, members);
  const parts = result.map(r => {
    if (r === null) return encodeBulkString(null);
    // Each element is [longitude, latitude]
    return `*2\r\n${encodeBulkString(String(r[0]))}${encodeBulkString(String(r[1]))}`;
  });
  return `*${parts.length}\r\n${parts.join('')}`;
}

async function handleGeodist(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 3) {
    return encodeError("wrong number of arguments for 'GEODIST' command");
  }
  const key = args[0];
  const member1 = args[1];
  const member2 = args[2];
  let unit: 'm' | 'km' | 'ft' | 'mi' = 'm';
  if (args.length >= 4) {
    const u = args[3].toLowerCase();
    if (u === 'km' || u === 'ft' || u === 'mi' || u === 'm') {
      unit = u as 'm' | 'km' | 'ft' | 'mi';
    } else {
      return encodeError('ERR unsupported unit provided. please use m, km, ft, mi');
    }
  }
  const result = await ctx.storage.geodist(key, member1, member2, unit);
  if (result === null) return encodeBulkString(null);
  return encodeBulkString(String(result));
}

async function handleGeoradius(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 5) {
    return encodeError("wrong number of arguments for 'GEORADIUS' command");
  }
  const key = args[0];
  const longitude = parseFloat(args[1]);
  const latitude = parseFloat(args[2]);
  const radius = parseFloat(args[3]);
  if (isNaN(longitude) || isNaN(latitude) || isNaN(radius)) {
    return encodeError('ERR value is not a valid float');
  }
  const unitArg = args[4].toLowerCase();
  let unit: 'm' | 'km' | 'ft' | 'mi' = 'm';
  if (unitArg === 'km' || unitArg === 'ft' || unitArg === 'mi' || unitArg === 'm') {
    unit = unitArg as 'm' | 'km' | 'ft' | 'mi';
  } else {
    return encodeError('ERR unsupported unit provided. please use m, km, ft, mi');
  }
  let withCoord = false, withDist = false, withHash = false;
  let count: number | undefined;
  let sort: 'ASC' | 'DESC' | undefined;
  let store: string | undefined;
  let storeDist: string | undefined;
  for (let i = 5; i < args.length; i++) {
    const opt = args[i].toUpperCase();
    if (opt === 'WITHCOORD') { withCoord = true; }
    else if (opt === 'WITHDIST') { withDist = true; }
    else if (opt === 'WITHASH') { withHash = true; }
    else if (opt === 'COUNT') {
      i++; if (i >= args.length) return encodeError('ERR syntax error');
      count = parseInt(args[i]);
      if (isNaN(count)) return encodeError('ERR value is not an integer or out of range');
    }
    else if (opt === 'ASC') { sort = 'ASC'; }
    else if (opt === 'DESC') { sort = 'DESC'; }
    else if (opt === 'STORE') {
      i++; if (i >= args.length) return encodeError('ERR syntax error');
      store = args[i];
    }
    else if (opt === 'STOREDIST') {
      i++; if (i >= args.length) return encodeError('ERR syntax error');
      storeDist = args[i];
    }
  }
  const options: { withCoord?: boolean; withDist?: boolean; withHash?: boolean; count?: number; sort?: 'ASC' | 'DESC'; store?: string; storeDist?: string } = {};
  if (withCoord) options.withCoord = true;
  if (withDist) options.withDist = true;
  if (withHash) options.withHash = true;
  if (count !== undefined) options.count = count;
  if (sort) options.sort = sort;
  if (store) options.store = store;
  if (storeDist) options.storeDist = storeDist;
  const result = await ctx.storage.georadius(key, longitude, latitude, radius, unit, options);
  // If STORE or STOREDIST was used, return integer (count)
  if (store || storeDist) {
    return encodeInteger(result.length);
  }
  if (!withCoord && !withDist && !withHash) {
    // Just member names
    return encodeArray(result.map(r => r.member));
  }
  // Array of arrays
  const parts = result.map(r => {
    const items: string[] = [encodeBulkString(r.member)];
    if (withDist) items.push(encodeBulkString(String(r.distance)));
    if (withHash) items.push(encodeInteger(r.geohash ? parseInt(String(r.geohash)) : 0));
    if (withCoord && r.longitude !== undefined && r.latitude !== undefined) {
      items.push(`*2\r\n${encodeBulkString(String(r.longitude))}${encodeBulkString(String(r.latitude))}`);
    }
    return `*${items.length}\r\n${items.join('')}`;
  });
  return `*${parts.length}\r\n${parts.join('')}`;
}

async function handleGeoradiusbymember(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 4) {
    return encodeError("wrong number of arguments for 'GEORADIUSBYMEMBER' command");
  }
  const key = args[0];
  const member = args[1];
  const radius = parseFloat(args[2]);
  if (isNaN(radius)) {
    return encodeError('ERR value is not a valid float');
  }
  const unitArg = args[3].toLowerCase();
  let unit: 'm' | 'km' | 'ft' | 'mi' = 'm';
  if (unitArg === 'km' || unitArg === 'ft' || unitArg === 'mi' || unitArg === 'm') {
    unit = unitArg as 'm' | 'km' | 'ft' | 'mi';
  } else {
    return encodeError('ERR unsupported unit provided. please use m, km, ft, mi');
  }
  let withCoord = false, withDist = false, withHash = false;
  let count: number | undefined;
  let sort: 'ASC' | 'DESC' | undefined;
  let store: string | undefined;
  let storeDist: string | undefined;
  for (let i = 4; i < args.length; i++) {
    const opt = args[i].toUpperCase();
    if (opt === 'WITHCOORD') { withCoord = true; }
    else if (opt === 'WITHDIST') { withDist = true; }
    else if (opt === 'WITHASH') { withHash = true; }
    else if (opt === 'COUNT') {
      i++; if (i >= args.length) return encodeError('ERR syntax error');
      count = parseInt(args[i]);
      if (isNaN(count)) return encodeError('ERR value is not an integer or out of range');
    }
    else if (opt === 'ASC') { sort = 'ASC'; }
    else if (opt === 'DESC') { sort = 'DESC'; }
    else if (opt === 'STORE') {
      i++; if (i >= args.length) return encodeError('ERR syntax error');
      store = args[i];
    }
    else if (opt === 'STOREDIST') {
      i++; if (i >= args.length) return encodeError('ERR syntax error');
      storeDist = args[i];
    }
  }
  const options: { withCoord?: boolean; withDist?: boolean; withHash?: boolean; count?: number; sort?: 'ASC' | 'DESC'; store?: string; storeDist?: string } = {};
  if (withCoord) options.withCoord = true;
  if (withDist) options.withDist = true;
  if (withHash) options.withHash = true;
  if (count !== undefined) options.count = count;
  if (sort) options.sort = sort;
  if (store) options.store = store;
  if (storeDist) options.storeDist = storeDist;
  const result = await ctx.storage.georadiusbymember(key, member, radius, unit, options);
  if (store || storeDist) {
    return encodeInteger(result.length);
  }
  if (!withCoord && !withDist && !withHash) {
    return encodeArray(result.map(r => r.member));
  }
  const parts = result.map(r => {
    const items: string[] = [encodeBulkString(r.member)];
    if (withDist) items.push(encodeBulkString(String(r.distance)));
    if (withHash) items.push(encodeInteger(r.geohash ? parseInt(String(r.geohash)) : 0));
    if (withCoord && r.longitude !== undefined && r.latitude !== undefined) {
      items.push(`*2\r\n${encodeBulkString(String(r.longitude))}${encodeBulkString(String(r.latitude))}`);
    }
    return `*${items.length}\r\n${items.join('')}`;
  });
  return `*${parts.length}\r\n${parts.join('')}`;
}

async function handleGeosearch(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 4) {
    return encodeError("wrong number of arguments for 'GEOSEARCH' command");
  }
  const key = args[0];
  let fromMember: string | undefined;
  let fromLongitude: number | undefined;
  let fromLatitude: number | undefined;
  let byRadius: { radius: number; unit: 'm' | 'km' | 'ft' | 'mi' } | undefined;
  let byBox: { width: number; height: number; unit: 'm' | 'km' | 'ft' | 'mi' } | undefined;
  let sort: 'ASC' | 'DESC' | undefined;
  let count: number | undefined;
  let any: boolean | undefined;
  let withCoord = false, withDist = false, withHash = false;

  let i = 1;
  while (i < args.length) {
    const opt = args[i].toUpperCase();
    if (opt === 'FROMMEMBER') {
      i++; if (i >= args.length) return encodeError('ERR syntax error');
      fromMember = args[i]; i++;
    } else if (opt === 'FROMLONGITUDE') {
      i++; if (i >= args.length) return encodeError('ERR syntax error');
      fromLongitude = parseFloat(args[i]);
      if (isNaN(fromLongitude)) return encodeError('ERR value is not a valid float');
      i++;
    } else if (opt === 'FROMLATITUDE') {
      i++; if (i >= args.length) return encodeError('ERR syntax error');
      fromLatitude = parseFloat(args[i]);
      if (isNaN(fromLatitude)) return encodeError('ERR value is not a valid float');
      i++;
    } else if (opt === 'BYRADIUS') {
      i++; if (i >= args.length) return encodeError('ERR syntax error');
      const radius = parseFloat(args[i]);
      if (isNaN(radius)) return encodeError('ERR value is not a valid float');
      i++; if (i >= args.length) return encodeError('ERR syntax error');
      const unitArg = args[i].toLowerCase();
      if (!['m', 'km', 'ft', 'mi'].includes(unitArg)) return encodeError('ERR unsupported unit provided. please use m, km, ft, mi');
      byRadius = { radius, unit: unitArg as 'm' | 'km' | 'ft' | 'mi' };
      i++;
    } else if (opt === 'BYBOX') {
      i++; if (i >= args.length) return encodeError('ERR syntax error');
      const width = parseFloat(args[i]);
      if (isNaN(width)) return encodeError('ERR value is not a valid float');
      i++; if (i >= args.length) return encodeError('ERR syntax error');
      const height = parseFloat(args[i]);
      if (isNaN(height)) return encodeError('ERR value is not a valid float');
      i++; if (i >= args.length) return encodeError('ERR syntax error');
      const unitArg = args[i].toLowerCase();
      if (!['m', 'km', 'ft', 'mi'].includes(unitArg)) return encodeError('ERR unsupported unit provided. please use m, km, ft, mi');
      byBox = { width, height, unit: unitArg as 'm' | 'km' | 'ft' | 'mi' };
      i++;
    } else if (opt === 'ASC') { sort = 'ASC'; i++; }
    else if (opt === 'DESC') { sort = 'DESC'; i++; }
    else if (opt === 'COUNT') {
      i++; if (i >= args.length) return encodeError('ERR syntax error');
      count = parseInt(args[i]);
      if (isNaN(count)) return encodeError('ERR value is not an integer or out of range');
      i++;
      // Check for ANY flag
      if (i < args.length && args[i].toUpperCase() === 'ANY') { any = true; i++; }
    } else if (opt === 'WITHCOORD') { withCoord = true; i++; }
    else if (opt === 'WITHDIST') { withDist = true; i++; }
    else if (opt === 'WITHASH') { withHash = true; i++; }
    else { return encodeError('ERR syntax error'); }
  }

  const options: { fromMember?: string; fromLongitude?: number; fromLatitude?: number; byRadius?: { radius: number; unit: 'm' | 'km' | 'ft' | 'mi' }; byBox?: { width: number; height: number; unit: 'm' | 'km' | 'ft' | 'mi' }; sort?: 'ASC' | 'DESC'; count?: number; any?: boolean; withCoord?: boolean; withDist?: boolean; withHash?: boolean } = {};
  if (fromMember !== undefined) options.fromMember = fromMember;
  if (fromLongitude !== undefined) options.fromLongitude = fromLongitude;
  if (fromLatitude !== undefined) options.fromLatitude = fromLatitude;
  if (byRadius) options.byRadius = byRadius;
  if (byBox) options.byBox = byBox;
  if (sort) options.sort = sort;
  if (count !== undefined) options.count = count;
  if (any) options.any = true;
  if (withCoord) options.withCoord = true;
  if (withDist) options.withDist = true;
  if (withHash) options.withHash = true;

  const result = await ctx.storage.geosearch(key, options);
  if (!withCoord && !withDist && !withHash) {
    return encodeArray(result.map(r => r.member));
  }
  const parts = result.map(r => {
    const items: string[] = [encodeBulkString(r.member)];
    if (withDist) items.push(encodeBulkString(String(r.distance)));
    if (withHash) items.push(encodeInteger(r.geohash ? parseInt(String(r.geohash)) : 0));
    if (withCoord && r.longitude !== undefined && r.latitude !== undefined) {
      items.push(`*2\r\n${encodeBulkString(String(r.longitude))}${encodeBulkString(String(r.latitude))}`);
    }
    return `*${items.length}\r\n${items.join('')}`;
  });
  return `*${parts.length}\r\n${parts.join('')}`;
}

async function handleGeosearchstore(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 5) {
    return encodeError("wrong number of arguments for 'GEOSEARCHSTORE' command");
  }
  const destination = args[0];
  const source = args[1];
  let fromMember: string | undefined;
  let fromLongitude: number | undefined;
  let fromLatitude: number | undefined;
  let byRadius: { radius: number; unit: 'm' | 'km' | 'ft' | 'mi' } | undefined;
  let byBox: { width: number; height: number; unit: 'm' | 'km' | 'ft' | 'mi' } | undefined;
  let sort: 'ASC' | 'DESC' | undefined;
  let count: number | undefined;
  let any: boolean | undefined;
  let storeDist = false;

  let i = 2;
  while (i < args.length) {
    const opt = args[i].toUpperCase();
    if (opt === 'FROMMEMBER') {
      i++; if (i >= args.length) return encodeError('ERR syntax error');
      fromMember = args[i]; i++;
    } else if (opt === 'FROMLONGITUDE') {
      i++; if (i >= args.length) return encodeError('ERR syntax error');
      fromLongitude = parseFloat(args[i]);
      if (isNaN(fromLongitude)) return encodeError('ERR value is not a valid float');
      i++;
    } else if (opt === 'FROMLATITUDE') {
      i++; if (i >= args.length) return encodeError('ERR syntax error');
      fromLatitude = parseFloat(args[i]);
      if (isNaN(fromLatitude)) return encodeError('ERR value is not a valid float');
      i++;
    } else if (opt === 'BYRADIUS') {
      i++; if (i >= args.length) return encodeError('ERR syntax error');
      const radius = parseFloat(args[i]);
      if (isNaN(radius)) return encodeError('ERR value is not a valid float');
      i++; if (i >= args.length) return encodeError('ERR syntax error');
      const unitArg = args[i].toLowerCase();
      if (!['m', 'km', 'ft', 'mi'].includes(unitArg)) return encodeError('ERR unsupported unit provided. please use m, km, ft, mi');
      byRadius = { radius, unit: unitArg as 'm' | 'km' | 'ft' | 'mi' };
      i++;
    } else if (opt === 'BYBOX') {
      i++; if (i >= args.length) return encodeError('ERR syntax error');
      const width = parseFloat(args[i]);
      if (isNaN(width)) return encodeError('ERR value is not a valid float');
      i++; if (i >= args.length) return encodeError('ERR syntax error');
      const height = parseFloat(args[i]);
      if (isNaN(height)) return encodeError('ERR value is not a valid float');
      i++; if (i >= args.length) return encodeError('ERR syntax error');
      const unitArg = args[i].toLowerCase();
      if (!['m', 'km', 'ft', 'mi'].includes(unitArg)) return encodeError('ERR unsupported unit provided. please use m, km, ft, mi');
      byBox = { width, height, unit: unitArg as 'm' | 'km' | 'ft' | 'mi' };
      i++;
    } else if (opt === 'ASC') { sort = 'ASC'; i++; }
    else if (opt === 'DESC') { sort = 'DESC'; i++; }
    else if (opt === 'COUNT') {
      i++; if (i >= args.length) return encodeError('ERR syntax error');
      count = parseInt(args[i]);
      if (isNaN(count)) return encodeError('ERR value is not an integer or out of range');
      i++;
      if (i < args.length && args[i].toUpperCase() === 'ANY') { any = true; i++; }
    } else if (opt === 'STOREDIST') { storeDist = true; i++; }
    else { return encodeError('ERR syntax error'); }
  }

  const options: { fromMember?: string; fromLongitude?: number; fromLatitude?: number; byRadius?: { radius: number; unit: 'm' | 'km' | 'ft' | 'mi' }; byBox?: { width: number; height: number; unit: 'm' | 'km' | 'ft' | 'mi' }; sort?: 'ASC' | 'DESC'; count?: number; any?: boolean; storeDist?: boolean } = {};
  if (fromMember !== undefined) options.fromMember = fromMember;
  if (fromLongitude !== undefined) options.fromLongitude = fromLongitude;
  if (fromLatitude !== undefined) options.fromLatitude = fromLatitude;
  if (byRadius) options.byRadius = byRadius;
  if (byBox) options.byBox = byBox;
  if (sort) options.sort = sort;
  if (count !== undefined) options.count = count;
  if (any) options.any = true;
  if (storeDist) options.storeDist = true;

  const result = await ctx.storage.geosearchstore(destination, source, options);
  return encodeInteger(result);
}

async function handleGeoradiusRo(ctx: HandlerContext, args: string[]): Promise<string> {
  // Same as GEORADIUS but STORE/STOREDIST are not allowed
  if (args.length < 5) {
    return encodeError("wrong number of arguments for 'GEORADIUS_RO' command");
  }
  const key = args[0];
  const longitude = parseFloat(args[1]);
  const latitude = parseFloat(args[2]);
  const radius = parseFloat(args[3]);
  if (isNaN(longitude) || isNaN(latitude) || isNaN(radius)) {
    return encodeError('ERR value is not a valid float');
  }
  const unitArg = args[4].toLowerCase();
  let unit: 'm' | 'km' | 'ft' | 'mi' = 'm';
  if (unitArg === 'km' || unitArg === 'ft' || unitArg === 'mi' || unitArg === 'm') {
    unit = unitArg as 'm' | 'km' | 'ft' | 'mi';
  } else {
    return encodeError('ERR unsupported unit provided. please use m, km, ft, mi');
  }
  let withCoord = false, withDist = false, withHash = false;
  let count: number | undefined;
  let sort: 'ASC' | 'DESC' | undefined;
  for (let i = 5; i < args.length; i++) {
    const opt = args[i].toUpperCase();
    if (opt === 'WITHCOORD') { withCoord = true; }
    else if (opt === 'WITHDIST') { withDist = true; }
    else if (opt === 'WITHASH') { withHash = true; }
    else if (opt === 'COUNT') {
      i++; if (i >= args.length) return encodeError('ERR syntax error');
      count = parseInt(args[i]);
      if (isNaN(count)) return encodeError('ERR value is not an integer or out of range');
    }
    else if (opt === 'ASC') { sort = 'ASC'; }
    else if (opt === 'DESC') { sort = 'DESC'; }
    else if (opt === 'STORE' || opt === 'STOREDIST') {
      return encodeError(`${opt} option is not allowed on GEORADIUS_RO`);
    }
  }
  const options: { withCoord?: boolean; withDist?: boolean; withHash?: boolean; count?: number; sort?: 'ASC' | 'DESC' } = {};
  if (withCoord) options.withCoord = true;
  if (withDist) options.withDist = true;
  if (withHash) options.withHash = true;
  if (count !== undefined) options.count = count;
  if (sort) options.sort = sort;
  const result = await ctx.storage.georadius(key, longitude, latitude, radius, unit, options);
  if (!withCoord && !withDist && !withHash) {
    return encodeArray(result.map(r => r.member));
  }
  const parts = result.map(r => {
    const items: string[] = [encodeBulkString(r.member)];
    if (withDist) items.push(encodeBulkString(String(r.distance)));
    if (withHash) items.push(encodeInteger(r.geohash ? parseInt(String(r.geohash)) : 0));
    if (withCoord && r.longitude !== undefined && r.latitude !== undefined) {
      items.push(`*2\r\n${encodeBulkString(String(r.longitude))}${encodeBulkString(String(r.latitude))}`);
    }
    return `*${items.length}\r\n${items.join('')}`;
  });
  return `*${parts.length}\r\n${parts.join('')}`;
}

async function handleGeoradiusbymemberRo(ctx: HandlerContext, args: string[]): Promise<string> {
  // Same as GEORADIUSBYMEMBER but STORE/STOREDIST are not allowed
  if (args.length < 4) {
    return encodeError("wrong number of arguments for 'GEORADIUSBYMEMBER_RO' command");
  }
  const key = args[0];
  const member = args[1];
  const radius = parseFloat(args[2]);
  if (isNaN(radius)) {
    return encodeError('ERR value is not a valid float');
  }
  const unitArg = args[3].toLowerCase();
  let unit: 'm' | 'km' | 'ft' | 'mi' = 'm';
  if (unitArg === 'km' || unitArg === 'ft' || unitArg === 'mi' || unitArg === 'm') {
    unit = unitArg as 'm' | 'km' | 'ft' | 'mi';
  } else {
    return encodeError('ERR unsupported unit provided. please use m, km, ft, mi');
  }
  let withCoord = false, withDist = false, withHash = false;
  let count: number | undefined;
  let sort: 'ASC' | 'DESC' | undefined;
  for (let i = 4; i < args.length; i++) {
    const opt = args[i].toUpperCase();
    if (opt === 'WITHCOORD') { withCoord = true; }
    else if (opt === 'WITHDIST') { withDist = true; }
    else if (opt === 'WITHASH') { withHash = true; }
    else if (opt === 'COUNT') {
      i++; if (i >= args.length) return encodeError('ERR syntax error');
      count = parseInt(args[i]);
      if (isNaN(count)) return encodeError('ERR value is not an integer or out of range');
    }
    else if (opt === 'ASC') { sort = 'ASC'; }
    else if (opt === 'DESC') { sort = 'DESC'; }
    else if (opt === 'STORE' || opt === 'STOREDIST') {
      return encodeError(`${opt} option is not allowed on GEORADIUSBYMEMBER_RO`);
    }
  }
  const options: { withCoord?: boolean; withDist?: boolean; withHash?: boolean; count?: number; sort?: 'ASC' | 'DESC' } = {};
  if (withCoord) options.withCoord = true;
  if (withDist) options.withDist = true;
  if (withHash) options.withHash = true;
  if (count !== undefined) options.count = count;
  if (sort) options.sort = sort;
  const result = await ctx.storage.georadiusbymember(key, member, radius, unit, options);
  if (!withCoord && !withDist && !withHash) {
    return encodeArray(result.map(r => r.member));
  }
  const parts = result.map(r => {
    const items: string[] = [encodeBulkString(r.member)];
    if (withDist) items.push(encodeBulkString(String(r.distance)));
    if (withHash) items.push(encodeInteger(r.geohash ? parseInt(String(r.geohash)) : 0));
    if (withCoord && r.longitude !== undefined && r.latitude !== undefined) {
      items.push(`*2\r\n${encodeBulkString(String(r.longitude))}${encodeBulkString(String(r.latitude))}`);
    }
    return `*${items.length}\r\n${items.join('')}`;
  });
  return `*${parts.length}\r\n${parts.join('')}`;
}