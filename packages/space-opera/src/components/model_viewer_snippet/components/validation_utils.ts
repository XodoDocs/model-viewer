/**
 * @license
 * Copyright 2021 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

// Code extracted from:
// https://github.com/donmccurdy/three-gltf-viewer/

import {validateBytes} from 'gltf-validator';

const SEVERITY_MAP = ['Errors', 'Warnings', 'Infos', 'Hints'];

export type Report = {
  info?: {
    version?: string;
    generator?: string;
    drawCallCount?: number;
    animationCount?: number;
    materialCount?: number;
    totalVertexCount?: number;
    totalTriangleCount?: number;
  };
  validatorVersion?: string;
  issues?: {
    numErrors?: number;
    numWarnings?: number;
    numHints?: number;
    numInfos?: number;
  };
  errors?: Message;
  warnings?: Message;
  hints?: Message;
  infos?: Message;
};

export type Message = {
  code: string; message: string; pointer: string;
}[];

/**
 * Passes the gltf url to be validated.
 */
export async function validateGltf(url: string): Promise<Report> {
  return await fetch(url)
      .then((response) => response.arrayBuffer())
      .then(
          (buffer) => validateBytes(new Uint8Array(buffer), {
            externalResourceFunction: (uri) => resolveExternalResource(uri, url)
          }))
      .then((report) => setReport(report))
      .catch((e) => setReportException(e));
}

function setReportException(e) {
  console.log('Error,', e);
}

/**
 * Loads a resource (either locally or from the network) and returns it.
 */
function resolveExternalResource(uri: string, url: string) {
  const index = url.lastIndexOf('/');
  const baseURL = index === -1 ? './' : url.substr(0, index + 1);
  return fetch(baseURL + uri)
      .then((response) => response.arrayBuffer())
      .then((buffer) => {
        return new Uint8Array(buffer);
      });
}

/**
 * Sets the values of the report.
 * @param {GLTFValidator.Report} report returned object
 */
function setReport(report) {
  report.issues.maxSeverity = -1;
  SEVERITY_MAP.forEach((severity, index) => {
    if (report.issues[`num${severity}`] > 0 &&
        report.issues.maxSeverity === -1) {
      report.issues.maxSeverity = index;
    }
  });
  report.errors = report.issues.messages.filter((msg) => msg.severity === 0);
  report.warnings = report.issues.messages.filter((msg) => msg.severity === 1);
  report.infos = report.issues.messages.filter((msg) => msg.severity === 2);
  report.hints = report.issues.messages.filter((msg) => msg.severity === 3);
  groupMessages(report);
  return report;
}

/**
 * Orders messages for errors correctly.
 */
function groupMessages(report) {
  const CODES = {
    ACCESSOR_NON_UNIT: {
      message: '{count} accessor elements not of unit length: 0. [AGGREGATED]',
      pointerCounts: {}
    },
    ACCESSOR_ANIMATION_INPUT_NON_INCREASING: {
      message:
          '{count} animation input accessor elements not in ascending order. [AGGREGATED]',
      pointerCounts: {}
    }
  };

  report.errors.forEach((message) => {
    if (!CODES[message.code])
      return;
    if (!CODES[message.code].pointerCounts[message.pointer]) {
      CODES[message.code].pointerCounts[message.pointer] = 0;
    }
    CODES[message.code].pointerCounts[message.pointer]++;
  });
  report.errors = report.errors.filter((message) => {
    if (!CODES[message.code])
      return true;
    if (!CODES[message.code].pointerCounts[message.pointer])
      return true;
    return CODES[message.code].pointerCounts[message.pointer] < 2;
  });
  Object.keys(CODES).forEach((code) => {
    Object.keys(CODES[code].pointerCounts).forEach((pointer) => {
      report.errors.push({
        code: code,
        pointer: pointer,
        message: CODES[code].message.replace(
            '{count}', CODES[code].pointerCounts[pointer])
      });
    });
  });
}
