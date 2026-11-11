import Foundation

// The names react-native-webrtc's ScreenCapturer listens for to start and stop reading the socket
enum DarwinNotification: String {
  case broadcastStarted = "iOS_BroadcastStarted"
  case broadcastStopped = "iOS_BroadcastStopped"
}

final class DarwinNotificationCenter {
  static let shared = DarwinNotificationCenter()
  private let center = CFNotificationCenterGetDarwinNotifyCenter()

  func post(_ name: DarwinNotification) {
    CFNotificationCenterPostNotification(center, CFNotificationName(rawValue: name.rawValue as CFString), nil, nil, true)
  }
}
