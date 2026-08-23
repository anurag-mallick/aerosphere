import React, { useState, useEffect } from 'react'
import './App.css'

interface VideoClip {
  id: string
  name: string
  path: string
  duration: number
  thumbnail?: string
  format: 'insv' | 'mp4'
  metadata?: {
    resolution?: string
    fps?: number
    codec?: string
    gyroData?: any
  }
}

interface PhotoClip {
  id: string
  name: string
  path: string
  thumbnail?: string
}

interface TimelineState {
  isPlaying: boolean
  currentTime: number
  duration: number
  zoom: number
  tracks: TimelineTrack[]
}

interface TimelineTrack {
  id: string
  name: string
  type: 'video' | 'audio' | 'effects' | 'text'
  isVisible: boolean
  clips: TimelineClip[]
}

interface TimelineClip {
  id: string
  name: string
  type: 'video' | 'photo' | 'audio'
  position: number
  duration: number
  progress: number
  isSelected: boolean
}

function App() {
  const [videoClips, setVideoClips] = useState<VideoClip[]>([])
  const [photoClips, setPhotoClips] = useState<PhotoClip[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const [timelineState, setTimelineState] = useState<TimelineState>({
    isPlaying: false,
    currentTime: 0,
    duration: 300,
    zoom: 1,
    tracks: [
      {
        id: 'track-1',
        name: 'Video Track',
        type: 'video',
        isVisible: true,
        clips: [
          {
            id: 'clip-1',
            name: 'Sample Video',
            type: 'video',
            position: 0,
            duration: 120,
            progress: 30,
            isSelected: false
          }
        ]
      },
      {
        id: 'track-2',
        name: 'Audio Track',
        type: 'audio',
        isVisible: true,
        clips: [
          {
            id: 'clip-2',
            name: 'Background Music',
            type: 'audio',
            position: 0,
            duration: 300,
            progress: 50,
            isSelected: false
          }
        ]
      }
    ]
  })

  useEffect(() => {
    // Load clips from local storage or recent files
    const savedVideoClips = localStorage.getItem('videoClips')
    const savedPhotoClips = localStorage.getItem('photoClips')
    
    if (savedVideoClips) {
      setVideoClips(JSON.parse(savedVideoClips))
    }
    if (savedPhotoClips) {
      setPhotoClips(JSON.parse(savedPhotoClips))
    }
  }, [])

  const handleVideoImport = async () => {
    try {
      setIsLoading(true)
      setError(null)
      
      // Use Electron API to open file dialog
      const result = await window.electronAPI.openFileDialog({
        fileTypes: [
          { name: 'Video Files', extensions: ['insv', 'mp4'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })
      
      if (result && result.length > 0) {
        const newClips: VideoClip[] = result.map((path: string) => {
          const fileName = path.split('/').pop() || path
          const ext = path.split('.').pop()?.toLowerCase()
          const isInsv = ext === 'insv'
          
          return {
            id: Math.random().toString(36).substr(2, 9),
            name: fileName,
            path,
            duration: 0, // Will be populated after processing
            format: isInsv ? 'insv' : 'mp4'
          }
        })
        
        const updatedClips = [...videoClips, ...newClips]
        setVideoClips(updatedClips)
        localStorage.setItem('videoClips', JSON.stringify(updatedClips))
        
        // Process clips to extract metadata
        await processClips(updatedClips)
      }
    } catch (err) {
      setError('Failed to import videos: ' + (err as Error).message)
    } finally {
      setIsLoading(false)
    }
  }

  const handlePhotoImport = async () => {
    try {
      setIsLoading(true)
      setError(null)
      
      const result = await window.electronAPI.openFileDialog({
        fileTypes: [
          { name: 'Image Files', extensions: ['jpg', 'jpeg', 'png', 'heic'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })
      
      if (result && result.length > 0) {
        const newPhotos: PhotoClip[] = result.map((path: string) => {
          const fileName = path.split('/').pop() || path
          return {
            id: Math.random().toString(36).substr(2, 9),
            name: fileName,
            path
          }
        })
        
        const updatedPhotos = [...photoClips, ...newPhotos]
        setPhotoClips(updatedPhotos)
        localStorage.setItem('photoClips', JSON.stringify(updatedPhotos))
      }
    } catch (err) {
      setError('Failed to import photos: ' + (err as Error).message)
    } finally {
      setIsLoading(false)
    }
  }

  const processClips = async (clips: VideoClip[]) => {
    // Process clips to extract metadata and convert .insv files
    for (const clip of clips) {
      try {
        if (clip.format === 'insv') {
          // Process .insv file
          await processInsvClip(clip)
        } else {
          // Process standard MP4 file
          await processMp4Clip(clip)
        }
      } catch (err) {
        console.error(`Error processing clip ${clip.name}:`, err)
      }
    }
  }

  const processInsvClip = async (clip: VideoClip) => {
    // This would use FFmpeg to process .insv files
    // For now, we'll simulate the processing
    clip.duration = 120 // Simulated duration
    clip.metadata = {
      resolution: '5.7K (5760×2880)',
      fps: 30,
      codec: 'H.264',
      gyroData: { hasGyro: true }
    }
  }

  const processMp4Clip = async (clip: VideoClip) => {
    // This would use FFmpeg to process MP4 files
    clip.duration = 90 // Simulated duration
    clip.metadata = {
      resolution: '4K (3840×2160)',
      fps: 60,
      codec: 'H.265'
    }
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  const handleExport = () => {
    console.log('Export functionality would be implemented here')
  }

  const toggleTrack = (trackId: string) => {
    setTimelineState(prev => ({
      ...prev,
      tracks: prev.tracks.map(track => 
        track.id === trackId ? { ...track, isVisible: !track.isVisible } : track
      )
    }))
  }

  const addTrack = (type: 'video' | 'audio' | 'effects' | 'text') => {
    const trackNames = {
      video: 'Video Track',
      audio: 'Audio Track',
      effects: 'Effects Track',
      text: 'Text Track'
    }
    
    const newTrack: TimelineTrack = {
      id: `track-${Date.now()}`,
      name: trackNames[type],
      type,
      isVisible: true,
      clips: []
    }
    
    setTimelineState(prev => ({
      ...prev,
      tracks: [...prev.tracks, newTrack]
    }))
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Video Editor</h1>
        <div className="controls">
          <button 
            onClick={handleVideoImport}
            disabled={isLoading}
            className="btn-primary"
          >
            Import Videos
          </button>
          <button 
            onClick={handlePhotoImport}
            disabled={isLoading}
            className="btn-secondary"
          >
            Import Photos
          </button>
        </div>
      </header>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      <main className="main-content">
        <div className="sidebar">
          <div className="media-library">
            <h2>Video Library</h2>
            {videoClips.length === 0 ? (
              <div className="empty-state">
                <p>No videos imported yet</p>
                <p className="small">Click "Import Videos" to add .insv or MP4 files</p>
              </div>
            ) : (
              <div className="clips-grid">
                {videoClips.map((clip) => (
                  <div key={clip.id} className="clip-item">
                    <div className="clip-thumbnail">
                      <span>🎥</span>
                    </div>
                    <div className="clip-info">
                      <p className="clip-name">{clip.name}</p>
                      <p className="clip-meta">
                        {clip.format === 'insv' ? 'Insta 360' : 'Standard'} • {clip.duration}s
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="media-library">
            <h2>Photo Library</h2>
            {photoClips.length === 0 ? (
              <div className="empty-state">
                <p>No photos imported yet</p>
                <p className="small">Click "Import Photos" to add images</p>
              </div>
            ) : (
              <div className="clips-grid">
                {photoClips.map((photo) => (
                  <div key={photo.id} className="clip-item">
                    <div className="clip-thumbnail">
                      <span>📷</span>
                    </div>
                    <div className="clip-info">
                      <p className="clip-name">{photo.name}</p>
                      <p className="clip-meta">Photo</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="timeline-area">
          <div className="timeline-header">
            <h2>Timeline</h2>
            <div className="timeline-controls">
              <button 
                className="btn-small" 
                onClick={() => setTimelineState(prev => ({ ...prev, isPlaying: !prev.isPlaying }))}
              >
                {timelineState.isPlaying ? 'Pause' : 'Play'}
              </button>
              <button className="btn-small" onClick={handleExport}>Export</button>
              <button 
                className="btn-small" 
                onClick={() => setTimelineState(prev => ({ ...prev, zoom: Math.min(prev.zoom * 1.2, 10) }))}
              >
                Zoom In
              </button>
              <button 
                className="btn-small" 
                onClick={() => setTimelineState(prev => ({ ...prev, zoom: Math.max(prev.zoom / 1.2, 0.1) }))}
              >
                Zoom Out
              </button>
            </div>
          </div>
          
          <div className="timeline-toolbar">
            <button 
              className="btn-small" 
              onClick={() => addTrack('video')}
            >
              Add Video Track
            </button>
            <button 
              className="btn-small" 
              onClick={() => addTrack('audio')}
            >
              Add Audio Track
            </button>
            <button 
              className="btn-small" 
              onClick={() => addTrack('effects')}
            >
              Add Effects Track
            </button>
            <button 
              className="btn-small" 
              onClick={() => addTrack('text')}
            >
              Add Text Track
            </button>
          </div>

          <div className="timeline-container">
            <div className="timeline-header-bar">
              <div className="time-indicator">
                <span>00:00:00</span>
                <div className="time-ruler">
                  {[...Array(60)].map((_, i) => (
                    <div key={i} className="time-marker" style={{ left: `${i * 10}%` }}>
                      {i % 10 === 0 && <span>{Math.floor(i/10):02d}:00</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            
            <div className="timeline-tracks-container">
              {timelineState.tracks.map((track, trackIndex) => (
                <div key={track.id} className={`timeline-track ${track.type}`}>
                  <div className="track-header">
                    <span className="track-type-icon">
                      {track.type === 'video' ? '🎥' : track.type === 'audio' ? '🔊' : track.type === 'effects' ? '✨' : 'T'}
                    </span>
                    <span className="track-name">{track.name}</span>
                    <button 
                      className="btn-small track-toggle" 
                      onClick={() => toggleTrack(track.id)}
                    >
                      {track.isVisible ? '👁️' : '🚫'}
                    </button>
                  </div>
                  <div 
                    className="timeline-track-content"
                  >
                    <div className="timeline-clips">
                      {track.clips.map((clip) => (
                        <div 
                          key={clip.id} 
                          className={`timeline-clip ${clip.isSelected ? 'selected' : ''}`}
                          style={{ 
                            left: `${clip.position * timelineState.zoom}%`, 
                            width: `${clip.duration * timelineState.zoom}%`,
                            zIndex: clip.isSelected ? 10 : 1
                          }}
                        >
                          <div className="clip-preview">
                            <span>{clip.type === 'video' ? '🎥' : clip.type === 'photo' ? '📷' : '🎵'}</span>
                          </div>
                          <div className="clip-timeline-info">
                            <p className="clip-name">{clip.name}</p>
                            <div className="progress-bar">
                              <div 
                                className="progress-fill" 
                                style={{ width: `${clip.progress}%` }}
                              ></div>
                            </div>
                          </div>
                          <div className="clip-resize-handle"></div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="timeline-footer">
              <div className="current-time">
                <span>Current Time: {formatTime(timelineState.currentTime)}</span>
              </div>
              <div className="duration">
                <span>Duration: {formatTime(timelineState.duration)}</span>
              </div>
            </div>
          </div>
        </div>
      </main>

      {isLoading && (
        <div className="loading-overlay">
          <div className="spinner"></div>
          <p>Processing files...</p>
        </div>
      )}
    </div>
  )
}

export default App