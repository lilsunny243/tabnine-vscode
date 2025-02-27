import * as semver from "semver";
import { commands, Uri } from "vscode";
import {
  BETA_CHANNEL_MESSAGE_SHOWN_KEY,
  INSTALL_COMMAND,
  LATEST_RELEASE_URL,
} from "../globals/consts";
import {
  downloadFileToDestination,
  downloadFileToStr,
} from "../utils/download.utils";
import tabnineExtensionProperties from "../globals/tabnineExtensionProperties";
import createTempFileWithPostfix from "../utils/file.utils";
import showMessage from "./messages";
import {
  getAvailableAlphaVersion,
  getCurrentVersion,
  isPreReleaseChannelSupported,
  updatePersistedAlphaVersion,
} from "./versions";
import { ExtensionContext, GitHubReleaseResponse } from "./types";
import { Capability, isCapabilityEnabled } from "../capabilities/capabilities";
import { Logger } from "../utils/logger";

const badVersion = "9999.9999.9999";

export default async function handlePreReleaseChannels(
  context: ExtensionContext
): Promise<void> {
  try {
    void showNotificationForBetaChannelIfNeeded(context);
    if (userConsumesPreReleaseChannelUpdates()) {
      const artifactUrl = await getArtifactUrl();
      if (artifactUrl) {
        const availableVersion = getAvailableAlphaVersion(artifactUrl);

        if (isNewerAlphaVersionAvailable(context, availableVersion)) {
          const { name } = await createTempFileWithPostfix(".vsix");
          await downloadFileToDestination(artifactUrl, name);
          await commands.executeCommand(INSTALL_COMMAND, Uri.file(name));
          await updatePersistedAlphaVersion(context, availableVersion);

          void showMessage({
            messageId: "prerelease-installer-update",
            messageText: `TabNine has been updated to ${availableVersion} version. Please reload the window for the changes to take effect.`,
            buttonText: "Reload",
            action: () =>
              void commands.executeCommand("workbench.action.reloadWindow"),
          });
        }
      }
    }
  } catch (e) {
    Logger.error(e);
  }
}

async function getArtifactUrl(): Promise<string | undefined> {
  const response = JSON.parse(
    await downloadFileToStr(LATEST_RELEASE_URL)
  ) as GitHubReleaseResponse;
  return response.filter(({ prerelease }) => prerelease).sort(({ id }) => id)[0]
    ?.assets[0]?.browser_download_url;
}

function isNewerAlphaVersionAvailable(
  context: ExtensionContext,
  availableVersion: string
): boolean {
  const currentVersion = getCurrentVersion(context);
  const availableSemverCoerce = semver.coerce(availableVersion)?.version || "";

  const isNewerVersion =
    !!currentVersion &&
    semver.gt(availableVersion, currentVersion) &&
    semver.neq(availableSemverCoerce, badVersion);
  const isAlphaAvailable = !!semver
    .prerelease(availableVersion)
    ?.includes("alpha");
  const isSameWithAlphaAvailable =
    !!currentVersion &&
    semver.eq(availableSemverCoerce, currentVersion) &&
    isAlphaAvailable;

  return (isAlphaAvailable && isNewerVersion) || isSameWithAlphaAvailable;
}

async function showNotificationForBetaChannelIfNeeded(
  context: ExtensionContext
) {
  const didShowMessage = context.globalState.get<boolean>(
    BETA_CHANNEL_MESSAGE_SHOWN_KEY
  );

  const shouldShowMessage =
    isPreReleaseChannelSupported() &&
    (tabnineExtensionProperties.isVscodeInsiders ||
      isCapabilityEnabled(Capability.ALPHA_CAPABILITY)) &&
    !didShowMessage &&
    !tabnineExtensionProperties.isExtensionBetaChannelEnabled;

  if (!shouldShowMessage) {
    return;
  }

  await showMessage({
    messageId: "vscode-join-beta-channel",
    messageText:
      "Do you wish to help Tabnine get better? Enable Tabnine's extension beta channel if so!",
    buttonText: "Open Settings",
    action: () =>
      void commands.executeCommand(
        "workbench.action.openSettings",
        "tabnine.receiveBetaChannelUpdates"
      ),
  });

  await context.globalState.update(BETA_CHANNEL_MESSAGE_SHOWN_KEY, true);
}

function userConsumesPreReleaseChannelUpdates(): boolean {
  return (
    isPreReleaseChannelSupported() &&
    (isCapabilityEnabled(Capability.ALPHA_CAPABILITY) ||
      tabnineExtensionProperties.isExtensionBetaChannelEnabled)
  );
}
