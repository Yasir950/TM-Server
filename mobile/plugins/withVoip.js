// Native glue for lock-screen calls and screen sharing, applied at `expo prebuild` / EAS build.
// iOS: registers for PushKit VoIP pushes and reports each one to CallKit before iOS's deadline (it must happen in
//      native code, before JS is running). The JS side is mobile/lib/callkit.ts.
// Android: lets the incoming-call screen show over the lock screen, and gives notifee's foreground service the
//      mediaProjection type that screen sharing needs.
const fs = require("fs");
const path = require("path");
const { withAppDelegate, withAndroidManifest, withDangerousMod, AndroidConfig } = require("expo/config-plugins");

const BRIDGE = `
// Workchime: lock-screen calls (plugins/withVoip.js)
#import <RNCallKeep/RNCallKeep.h>
#import <RNVoipPushNotification/RNVoipPushNotificationManager.h>
`;

const DELEGATE = `

// Workchime: lock-screen calls (plugins/withVoip.js)
extension AppDelegate: PKPushRegistryDelegate {
  public func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
    RNVoipPushNotificationManager.didUpdate(pushCredentials, forType: type.rawValue)
  }

  public func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {}

  // iOS ends the app unless every VoIP push is reported to CallKit right away
  public func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith payload: PKPushPayload, for type: PKPushType, completion: @escaping () -> Void) {
    let data = payload.dictionaryPayload
    let kind = data["kind"] as? String ?? "call"
    let caller = data["caller"] as? String ?? "Workchime"
    let ring = (data["uuid"] as? String ?? UUID().uuidString).uppercased()
    RNVoipPushNotificationManager.didReceiveIncomingPush(with: payload, forType: type.rawValue)

    if kind == "call" {
      RNCallKeep.reportNewIncomingCall(ring, handle: data["where"] as? String ?? caller, handleType: "generic", hasVideo: true, localizedCallerName: caller, supportsHolding: false, supportsDTMF: false, supportsGrouping: false, supportsUngrouping: false, fromPushKit: true, payload: data, withCompletionHandler: completion)
      return
    }

    // Answered, declined or hung up elsewhere: stop the ring here. A call already in progress is left alone,
    // and the push is accounted for with a placeholder call that ends at once.
    let ringing = CXCallObserver().calls.contains { $0.uuid.uuidString == ring && !$0.hasConnected && !$0.hasEnded }
    if ringing { RNCallKeep.endCall(withUUID: ring, reason: 4) }
    let placeholder = UUID().uuidString
    RNCallKeep.reportNewIncomingCall(placeholder, handle: caller, handleType: "generic", hasVideo: false, localizedCallerName: caller, supportsHolding: false, supportsDTMF: false, supportsGrouping: false, supportsUngrouping: false, fromPushKit: true, payload: nil, withCompletionHandler: nil)
    RNCallKeep.endCall(withUUID: placeholder, reason: 2)
    completion()
  }
}
`;

function withIos(config) {
  config = withDangerousMod(config, [
    "ios",
    async (c) => {
      const dir = path.join(c.modRequest.platformProjectRoot, c.modRequest.projectName);
      const header = fs.readdirSync(dir).find((f) => f.endsWith("-Bridging-Header.h"));
      if (!header) throw new Error("withVoip: no Swift bridging header found");
      const file = path.join(dir, header);
      const src = fs.readFileSync(file, "utf8");
      if (!src.includes("RNCallKeep.h")) fs.writeFileSync(file, src + BRIDGE);
      return c;
    },
  ]);
  return withAppDelegate(config, (c) => {
    if (c.modResults.language !== "swift") throw new Error("withVoip expects a Swift AppDelegate (Expo SDK 53+)");
    let src = c.modResults.contents;
    if (!src.includes("import PushKit")) src = src.replace(/^import Expo$/m, "import Expo\nimport PushKit\nimport CallKit");
    if (!src.includes("voipRegistration"))
      src = src.replace(/(didFinishLaunchingWithOptions[^{]*\{)/, "$1\n    RNVoipPushNotificationManager.voipRegistration()");
    if (!src.includes("PKPushRegistryDelegate")) src += DELEGATE;
    c.modResults.contents = src;
    return c;
  });
}

function withAndroid(config) {
  return withAndroidManifest(config, (c) => {
    const manifest = c.modResults;
    manifest.manifest.$["xmlns:tools"] = "http://schemas.android.com/tools";
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    const name = "app.notifee.core.ForegroundService";
    app.service = (app.service ?? []).filter((s) => s.$["android:name"] !== name);
    app.service.push({ $: { "android:name": name, "android:exported": "false", "android:foregroundServiceType": "mediaProjection", "tools:replace": "android:foregroundServiceType" } });
    // The incoming-call screen opens the app over the lock screen
    const main = AndroidConfig.Manifest.getMainActivityOrThrow(manifest);
    main.$["android:showWhenLocked"] = "true";
    main.$["android:turnScreenOn"] = "true";
    return c;
  });
}

module.exports = (config) => withAndroid(withIos(config));
