import ReplayKit

// Must match the app group in app.json (ios.entitlements and RTCAppGroupIdentifier)
private let appGroup = "group.app.workchime.mobile"

// Receives the screen from ReplayKit and forwards every third frame to the app (react-native-webrtc's ScreenCapturer)
class SampleHandler: RPBroadcastSampleHandler {
  private var connection: SocketConnection?
  private var uploader: SampleUploader?
  private var frameCount = 0

  private var socketPath: String {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)?.appendingPathComponent("rtc_SSFD").path ?? ""
  }

  override init() {
    super.init()
    if let c = SocketConnection(filePath: socketPath) {
      connection = c
      c.didClose = { [weak self] error in
        let stopped = NSError(domain: RPRecordingErrorDomain, code: 10001, userInfo: [NSLocalizedDescriptionKey: "Screen sharing stopped"])
        self?.finishBroadcastWithError(error ?? stopped)
      }
      uploader = SampleUploader(connection: c)
    }
  }

  override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
    frameCount = 0
    DarwinNotificationCenter.shared.post(.broadcastStarted)
    openConnection()
  }

  override func broadcastFinished() {
    DarwinNotificationCenter.shared.post(.broadcastStopped)
    connection?.close()
  }

  override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
    guard sampleBufferType == .video else { return }
    frameCount += 1
    if frameCount % 3 == 0 { uploader?.send(sample: sampleBuffer) }
  }

  // The app opens the socket once it hears broadcastStarted; keep trying until it's there
  private func openConnection() {
    let timer = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "broadcast.connectTimer"))
    timer.schedule(deadline: .now(), repeating: .milliseconds(100), leeway: .milliseconds(500))
    timer.setEventHandler { [weak self] in
      guard self?.connection?.open() == true else { return }
      timer.cancel()
    }
    timer.resume()
  }
}
