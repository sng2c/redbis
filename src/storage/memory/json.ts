// @ts-nocheck
import { jsonCoreMethods } from './json-core';
import { jsonAdvancedMethods } from './json-advanced';

export const jsonMethods = {
  ...jsonCoreMethods,
  ...jsonAdvancedMethods,
};