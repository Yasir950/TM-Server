// Incoming-call handling (CallKit, background pushes, notification actions) must be registered before the app,
// so it also works when a push launches the app headless
import "./lib/callkit";
import "expo-router/entry";
