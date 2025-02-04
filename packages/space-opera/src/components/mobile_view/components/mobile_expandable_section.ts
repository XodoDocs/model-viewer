/**
 * @license
 * Copyright 2020 Google LLC. All Rights Reserved.
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

import {customElement, html, LitElement, property, query, TemplateResult} from 'lit-element';

import {ArConfigState} from '../../../types';
import {CheckboxElement} from '../../shared/checkbox/checkbox';

/**
 * The delegated rendered component for the open mobile view.
 */
@customElement('mobile-expandable-section')
export class MobileExpanadableSection extends LitElement {
  @property({type: Boolean}) isDeployed?: boolean;
  @property({type: Boolean}) isDeployable?: boolean;
  @property({type: Function}) onInitialDeploy?: Function;

  @property({type: Boolean}) haveReceivedResponse?: boolean;
  @property({type: Boolean}) isSendingData?: boolean;
  @property({type: Boolean}) contentHasChanged?: boolean;

  @property({type: Function}) openModal?: Function;
  @property({type: Function}) postInfo?: Function;

  @property({type: Boolean}) defaultToSceneViewer?: boolean;
  @property({type: Function}) onSelectArMode?: Function;
  @property() arConfig?: ArConfigState;

  @property({type: Boolean}) iosAndNoUsdz?: boolean;
  @property({type: Function}) onUploadUSDZ?: Function;

  @query('me-checkbox#ar') arCheckbox!: CheckboxElement;
  @query('me-checkbox#ar-modes') arModesCheckbox!: CheckboxElement;

  renderDeployButton(): TemplateResult {
    return html`
    <mwc-button unelevated
      icon="file_download"
      ?disabled=${!this.isDeployable}
      @click=${this.onInitialDeploy}>
        Deploy Mobile
    </mwc-button>`;
  }

  get optionalMessage(): TemplateResult {
    const isOutOfSync = this.haveReceivedResponse &&
        (!this.isSendingData && this.contentHasChanged);
    if (isOutOfSync) {
      return html`
    <div style="color: #DC143C; margin-top: 5px;">
      Your mobile view is out of sync with the editor.
    </div>`;
    } else if (this.isSendingData) {
      return html`
    <div style="color: white; margin-top: 5px;">
      Sending data to mobile device. Textured models will take some time.
    </div>`;
    } else if (!this.haveReceivedResponse) {
      return html`
      <div style="color: white; margin-top: 5px;">
        Use the QR Code to open the mobile viewing page on a mobile device.
      </div>`;
    }
    return html``;
  }

  selectArMode() {
    this.onSelectArMode!(this.arModesCheckbox.checked);
  }

  renderMobileInfo() {
    const isOutOfSync = this.haveReceivedResponse &&
        (!this.isSendingData && this.contentHasChanged);
    const outOfSyncColor = isOutOfSync ? '#DC143C' : '#4285F4';
    return html`
    <div>
      <mwc-button unelevated @click=${
        this.openModal} style="margin-bottom: 10px;">
        View QR Code
      </mwc-button>
      <mwc-button unelevated icon="cached" @click=${this.postInfo}
        ?disabled=${
    !this.haveReceivedResponse || this.isSendingData}
        style="--mdc-theme-primary: ${outOfSyncColor}">
        Refresh Mobile
      </mwc-button>
      ${this.optionalMessage}
    </div>
    `;
  }

  renderAR() {
    return html`
    <div style="font-size: 14px; font-weight: 500; margin: 16px 0px 10px 0px;">
      AR Settings:
    </div> 
    <me-checkbox
      id="ar-modes"
      label="Default AR Mode to Scene Viewer"
      ?checked="${this.defaultToSceneViewer}"
      @change=${this.selectArMode}
      >
    </me-checkbox>
    `;
  }

  renderIos() {
    const needUsdzButton = this.iosAndNoUsdz ? '#DC143C' : '#4285F4';
    const uploadUsdzText = this.iosAndNoUsdz ? html`
    <div style="color: #DC143C; margin-top: 5px;">
      Upload a .usdz to view model in AR on an iOS device.
    </div>` :
                                               html``
    return html`
    <div style="font-size: 14px; font-weight: 500; margin: 16px 0px 10px 0px;">
      To enable AR on iOS, upload:
    </div> 
    <mwc-button unelevated icon="file_upload" @click=${this.onUploadUSDZ} 
      style="--mdc-theme-primary: ${needUsdzButton}">
      USDZ / REALITY
    </mwc-button>
    ${uploadUsdzText}
    `;
  }

  render() {
    return html`
      ${!this.isDeployed ? this.renderDeployButton() : html``}
      ${this.isDeployed ? this.renderMobileInfo() : html``}
      ${this.renderAR()}
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mobile-expandable-section': MobileExpanadableSection;
  }
}
