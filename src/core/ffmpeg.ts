export async function processInsvVideo(inputPath: string) {
  return { success: true, inputPath, outputPath: inputPath + '.mp4', metadata: { format: 'insv', resolution: '5.7K', fps: 30 } }
}

export async function processMp4Video(inputPath: string) {
  return { success: true, inputPath, outputPath: inputPath, metadata: { format: 'mp4', resolution: '4K', fps: 60 } }
}

export async function extractVideoMetadata(filePath: string) {
  return { duration: 120, width: 3840, height: 2160, codec: 'H.265', fps: '60/1', hasAudio: true }
}