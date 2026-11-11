import CoreImage
import Foundation
import ReplayKit

// Encodes frames as half-size JPEGs in the HTTP-style framing react-native-webrtc's ScreenCapturer reads
// (Content-Length, Buffer-Width, Buffer-Height, Buffer-Orientation) and writes them in chunks
class SampleUploader {
  private static let imageContext = CIContext(options: nil)
  private static let chunk = 10240

  private let lock = NSLock()
  private var ready = false
  private var isReady: Bool {
    get { lock.lock(); defer { lock.unlock() }; return ready }
    set { lock.lock(); ready = newValue; lock.unlock() }
  }
  private let connection: SocketConnection
  private var dataToSend: Data?
  private var byteIndex = 0
  private let queue = DispatchQueue(label: "app.workchime.broadcast.uploader")

  init(connection: SocketConnection) {
    self.connection = connection
    connection.didOpen = { [weak self] in self?.isReady = true }
    connection.streamHasSpaceAvailable = { [weak self] in
      self?.queue.async {
        if let sent = self?.sendChunk() { self?.isReady = !sent }
      }
    }
  }

  // Drops frames while the previous one is still being written
  @discardableResult func send(sample buffer: CMSampleBuffer) -> Bool {
    guard isReady else { return false }
    isReady = false
    dataToSend = prepare(sample: buffer)
    byteIndex = 0
    queue.async { [weak self] in self?.sendChunk() }
    return true
  }

  @discardableResult private func sendChunk() -> Bool {
    guard let data = dataToSend else { return false }
    let left = data.count - byteIndex
    let length = min(left, SampleUploader.chunk)
    let written = data[byteIndex..<(byteIndex + length)].withUnsafeBytes { raw -> Int in
      guard let ptr = raw.bindMemory(to: UInt8.self).baseAddress else { return 0 }
      return connection.writeToStream(buffer: ptr, maxLength: length)
    }
    if written > 0 {
      byteIndex += written
      if byteIndex >= data.count {
        dataToSend = nil
        byteIndex = 0
      }
    }
    return true
  }

  private func prepare(sample buffer: CMSampleBuffer) -> Data? {
    guard let image = CMSampleBufferGetImageBuffer(buffer) else { return nil }
    CVPixelBufferLockBaseAddress(image, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(image, .readOnly) }
    let scale = 2
    let width = CVPixelBufferGetWidth(image) / scale
    let height = CVPixelBufferGetHeight(image) / scale
    let orientation = (CMGetAttachment(buffer, key: RPVideoSampleOrientationKey as CFString, attachmentModeOut: nil) as? NSNumber)?.uintValue ?? 0
    let transform = CGAffineTransform(scaleX: 1.0 / CGFloat(scale), y: 1.0 / CGFloat(scale))
    let ci = CIImage(cvPixelBuffer: image).transformed(by: transform)
    guard let colorSpace = ci.colorSpace,
          let jpeg = SampleUploader.imageContext.jpegRepresentation(of: ci, colorSpace: colorSpace, options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.8])
    else { return nil }

    let message = CFHTTPMessageCreateResponse(nil, 200, nil, kCFHTTPVersion1_1).takeRetainedValue()
    CFHTTPMessageSetHeaderFieldValue(message, "Content-Length" as CFString, String(jpeg.count) as CFString)
    CFHTTPMessageSetHeaderFieldValue(message, "Buffer-Width" as CFString, String(width) as CFString)
    CFHTTPMessageSetHeaderFieldValue(message, "Buffer-Height" as CFString, String(height) as CFString)
    CFHTTPMessageSetHeaderFieldValue(message, "Buffer-Orientation" as CFString, String(orientation) as CFString)
    CFHTTPMessageSetBody(message, jpeg as CFData)
    return CFHTTPMessageCopySerializedMessage(message)?.takeRetainedValue() as Data?
  }
}
