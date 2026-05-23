// @ts-nocheck
import { zsetCoreMethods } from './zset-core';
import { zsetUnionMethods } from './zset-union';

export const zsetMethods = {
  ...zsetCoreMethods,
  ...zsetUnionMethods,
};