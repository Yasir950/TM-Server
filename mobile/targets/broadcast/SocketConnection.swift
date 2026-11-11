import Foundation

// A Unix domain socket client to the app's ScreenCapturer, through CFStreams on a background run loop
class SocketConnection: NSObject {
  var didOpen: (() -> Void)?
  var didClose: ((Error?) -> Void)?
  var streamHasSpaceAvailable: (() -> Void)?

  private let filePath: String
  private var socketHandle: Int32 = -1
  private var address: sockaddr_un?
  private var inputStream: InputStream?
  private var outputStream: OutputStream?
  private var networkQueue: DispatchQueue?
  private var shouldKeepRunning = false

  init?(filePath path: String) {
    filePath = path
    socketHandle = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
    guard socketHandle != -1 else { return nil }
  }

  func open() -> Bool {
    guard FileManager.default.fileExists(atPath: filePath), setupAddress(), connectSocket() else { return false }
    setupStreams()
    inputStream?.open()
    outputStream?.open()
    return true
  }

  func close() {
    unscheduleStreams()
    inputStream?.delegate = nil
    outputStream?.delegate = nil
    inputStream?.close()
    outputStream?.close()
    inputStream = nil
    outputStream = nil
  }

  func writeToStream(buffer: UnsafePointer<UInt8>, maxLength length: Int) -> Int {
    outputStream?.write(buffer, maxLength: length) ?? 0
  }

  private func setupAddress() -> Bool {
    var addr = sockaddr_un()
    guard filePath.count < MemoryLayout.size(ofValue: addr.sun_path) else { return false }
    _ = withUnsafeMutablePointer(to: &addr.sun_path.0) { ptr in
      filePath.withCString { strncpy(ptr, $0, filePath.count) }
    }
    address = addr
    return true
  }

  private func connectSocket() -> Bool {
    guard var addr = address else { return false }
    let status = withUnsafePointer(to: &addr) { ptr in
      ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        Darwin.connect(socketHandle, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
      }
    }
    return status == noErr
  }

  private func setupStreams() {
    var readStream: Unmanaged<CFReadStream>?
    var writeStream: Unmanaged<CFWriteStream>?
    CFStreamCreatePairWithSocket(kCFAllocatorDefault, socketHandle, &readStream, &writeStream)
    let closeSocket = Stream.PropertyKey(kCFStreamPropertyShouldCloseNativeSocket as String)
    inputStream = readStream?.takeRetainedValue()
    inputStream?.delegate = self
    inputStream?.setProperty(kCFBooleanTrue, forKey: closeSocket)
    outputStream = writeStream?.takeRetainedValue()
    outputStream?.delegate = self
    outputStream?.setProperty(kCFBooleanTrue, forKey: closeSocket)
    scheduleStreams()
  }

  private func scheduleStreams() {
    shouldKeepRunning = true
    networkQueue = DispatchQueue.global(qos: .userInitiated)
    networkQueue?.async { [weak self] in
      self?.inputStream?.schedule(in: .current, forMode: .common)
      self?.outputStream?.schedule(in: .current, forMode: .common)
      RunLoop.current.run()
      var running = false
      repeat {
        running = (self?.shouldKeepRunning ?? false) && RunLoop.current.run(mode: .default, before: .distantFuture)
      } while running
    }
  }

  private func unscheduleStreams() {
    networkQueue?.sync { [weak self] in
      self?.inputStream?.remove(from: .current, forMode: .common)
      self?.outputStream?.remove(from: .current, forMode: .common)
    }
    shouldKeepRunning = false
  }
}

extension SocketConnection: StreamDelegate {
  func stream(_ aStream: Stream, handle eventCode: Stream.Event) {
    switch eventCode {
    case .openCompleted:
      if aStream == outputStream { didOpen?() }
    case .hasBytesAvailable:
      // The app closing its end is how sharing stops from the app
      if aStream == inputStream {
        var byte: UInt8 = 0
        if inputStream?.read(&byte, maxLength: 1) == 0 && aStream.streamStatus == .atEnd {
          close()
          didClose?(nil)
        }
      }
    case .hasSpaceAvailable:
      if aStream == outputStream { streamHasSpaceAvailable?() }
    case .errorOccurred:
      close()
      didClose?(aStream.streamError)
    default:
      break
    }
  }
}
