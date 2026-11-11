// iOS screen sharing: a ReplayKit Broadcast Upload extension, added to the Xcode project by @bacons/apple-targets.
// It sends the screen to the app over a socket in the shared app group, where react-native-webrtc's
// ScreenCapturer picks it up (Info.plist RTCAppGroupIdentifier / RTCScreenSharingExtension in app.json).
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = () => ({
  type: "broadcast-upload",
  name: "WorkchimeBroadcast",
  bundleIdentifier: ".broadcast",
  deploymentTarget: "15.1",
  frameworks: ["ReplayKit"],
  entitlements: { "com.apple.security.application-groups": ["group.app.workchime.mobile"] },
});
