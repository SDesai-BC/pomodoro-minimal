import Cocoa

func renderKansoIcon(size: Int, outputPath: String) throws {
    let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: size,
        pixelsHigh: size,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    )!

    NSGraphicsContext.saveGraphicsState()
    defer { NSGraphicsContext.restoreGraphicsState() }

    guard let ctx = NSGraphicsContext(bitmapImageRep: rep)?.cgContext else {
        throw NSError(domain: "IconGen", code: 1, userInfo: [NSLocalizedDescriptionKey: "Failed to create CGContext"])
    }

    let s = CGFloat(size)
    let inset = s * 0.08
    let cardRect = CGRect(x: inset, y: inset, width: s - inset * 2, height: s - inset * 2)
    let cornerRadius = s * 0.21

    // Rounded background card (#141D2B — Deep Midnight Slate)
    let bgPath = CGPath(roundedRect: cardRect, cornerWidth: cornerRadius, cornerHeight: cornerRadius, transform: nil)
    ctx.addPath(bgPath)
    ctx.setFillColor(CGColor(srgbRed: 0.078, green: 0.114, blue: 0.169, alpha: 1.0))
    ctx.fillPath()

    // Subtle track ring (#263449)
    let center = CGPoint(x: s / 2, y: s / 2)
    let radius = s * 0.28
    ctx.setStrokeColor(CGColor(srgbRed: 0.149, green: 0.204, blue: 0.286, alpha: 1.0))
    ctx.setLineWidth(s * 0.055)
    ctx.addArc(center: center, radius: radius, startAngle: 0, endAngle: .pi * 2, clockwise: false)
    ctx.strokePath()

    // Cool Sky-Azure Blue Pomodoro progress arc (#63A9FF)
    ctx.setStrokeColor(CGColor(srgbRed: 0.388, green: 0.663, blue: 1.0, alpha: 1.0))
    ctx.setLineWidth(s * 0.055)
    ctx.setLineCap(.round)
    ctx.addArc(center: center, radius: radius, startAngle: .pi / 2, endAngle: -.pi * 0.85, clockwise: true)
    ctx.strokePath()

    // Center minimalist dot (#F4F7FB)
    let dotRadius = s * 0.055
    ctx.setFillColor(CGColor(srgbRed: 0.957, green: 0.969, blue: 0.984, alpha: 1.0))
    ctx.fillEllipse(in: CGRect(x: center.x - dotRadius, y: center.y - dotRadius, width: dotRadius * 2, height: dotRadius * 2))

    guard let pngData = rep.representation(using: .png, properties: [:]) else {
        throw NSError(domain: "IconGen", code: 2, userInfo: [NSLocalizedDescriptionKey: "Failed to encode PNG"])
    }
    try pngData.write(to: URL(fileURLWithPath: outputPath))
}

let args = CommandLine.arguments
guard args.count >= 3 else {
    fputs("Usage: GenerateIcons <webIconsDir> <iconsetDir>\n", stderr)
    exit(1)
}

let webIconsDir = args[1]
let iconsetDir = args[2]

try renderKansoIcon(size: 192, outputPath: "\(webIconsDir)/app-192.png")
try renderKansoIcon(size: 512, outputPath: "\(webIconsDir)/app-512.png")

let iconSpecs: [(String, Int)] = [
    ("icon_16x16.png", 16),
    ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32),
    ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128),
    ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256),
    ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512),
    ("icon_512x512@2x.png", 1024)
]

for (filename, px) in iconSpecs {
    try renderKansoIcon(size: px, outputPath: "\(iconsetDir)/\(filename)")
}
