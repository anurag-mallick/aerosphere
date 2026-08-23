import type { LibraryAudio, LibraryPhoto, LibraryVideo } from '../types/editor'
import { mediaUrl } from '../core/ffmpeg'
import { DroneIcon, Insta360Icon, AudioIcon } from './icons'

interface MediaLibraryProps {
  videos: LibraryVideo[]
  photos: LibraryPhoto[]
  audios: LibraryAudio[]
  convertingVideoId: string | null
  proxyBusyVideoId: string | null
  onGenerateProxy: (id: string) => void
  onImportVideos: () => void
  onImportPhotos: () => void
  onImportMusic: () => void
  onAddVideo: (video: LibraryVideo) => void
  onAddPhoto: (photo: LibraryPhoto) => void
  onAddAudio: (audio: LibraryAudio) => void
  onRemoveVideo: (id: string) => void
  onRemovePhoto: (id: string) => void
  onRemoveAudio: (id: string) => void
  onConvertInsv: (id: string) => void
  onStitchInsv: (id: string) => void
  stitchingVideoId: string | null
}

function metaLine(video: LibraryVideo): string {
  if (video.processing) return 'Reading…'
  const parts: string[] = []
  parts.push(video.format === 'insv' ? 'Insta360' : video.format === 'mp4' ? 'MP4' : 'Video')
  if (video.pairPath) parts.push('dual-lens pair')
  else if (video.format === 'insv') parts.push('single lens')
  if (video.duration > 0) {
    const mins = Math.floor(video.duration / 60)
    const secs = Math.floor(video.duration % 60)
    parts.push(`${mins}:${String(secs).padStart(2, '0')}`)
  }
  if (video.metadata?.resolution) parts.push(video.metadata.resolution)
  return parts.join(' · ')
}

function VideoCard({
  video,
  converting,
  proxyBusy,
  stitching,
  hasPair,
  onAdd,
  onRemove,
  onConvert,
  onProxy,
  onStitch,
}: {
  video: LibraryVideo
  converting: boolean
  proxyBusy: boolean
  stitching: boolean
  hasPair: boolean
  onAdd: () => void
  onRemove: () => void
  onConvert: () => void
  onProxy: () => void
  onStitch: () => void
}) {
  return (
    <div className="library-item">
      <div className="library-thumb">
        {video.thumbnail ? (
          <img src={video.thumbnail} alt={video.name} draggable={false} />
        ) : (
          <span className="thumb-fallback">
            {video.format === 'insv' || video.is360 ? (
              <Insta360Icon size={26} />
            ) : (
              <DroneIcon size={26} />
            )}
          </span>
        )}
        <span className={`source-chip ${video.is360 ? 'is-360' : 'is-drone'}`}>
          {video.is360 ? '360°' : 'DRONE'}
        </span>
      </div>
      <div className="library-item-info">
        <p className="clip-name" title={video.name}>
          {video.name}
        </p>
        <p className="clip-meta">{converting ? 'Converting to MP4…' : metaLine(video)}</p>
        <div className="item-actions">
          <button className="btn-tiny" onClick={onAdd} disabled={video.processing}>
            + Timeline
          </button>
          {video.format === 'insv' && (
            <button className="btn-tiny" onClick={onConvert} disabled={converting}>
              Convert
            </button>
          )}
          {video.format === 'insv' && hasPair && (
            <button className="btn-tiny" onClick={onStitch} disabled={stitching} title="Stitch the paired lens files into one equirectangular 360° video">
              🌐 Stitch
            </button>
          )}
          <button
            className="btn-tiny"
            onClick={onProxy}
            disabled={proxyBusy}
            title="Generate 480p proxy for smooth preview of high-res footage"
          >
            ⚡
          </button>
          <button className="btn-tiny btn-danger" onClick={onRemove} title="Remove from library">
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}

export function MediaLibrary(props: MediaLibraryProps) {
  const { videos, photos, audios, convertingVideoId, proxyBusyVideoId, stitchingVideoId } = props

  return (
    <aside className="sidebar">
      <section className="media-library">
        <header className="library-header">
          <h2>Videos</h2>
          <button className="btn-tiny" onClick={props.onImportVideos}>
            Import
          </button>
        </header>
        {videos.length === 0 ? (
          <p className="empty-hint">Import .insv or .mp4 footage</p>
        ) : (
          <div className="library-list">
            {videos.map((v) => (
              <VideoCard
                key={v.id}
                video={v}
                converting={convertingVideoId === v.id}
                proxyBusy={proxyBusyVideoId === v.id}
                stitching={stitchingVideoId === v.id}
                hasPair={!!v.pairPath}
                onStitch={() => props.onStitchInsv(v.id)}
                onProxy={() => props.onGenerateProxy(v.id)}
                onAdd={() => props.onAddVideo(v)}
                onRemove={() => props.onRemoveVideo(v.id)}
                onConvert={() => props.onConvertInsv(v.id)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="media-library">
        <header className="library-header">
          <h2>Photos</h2>
          <button className="btn-tiny" onClick={props.onImportPhotos}>
            Import
          </button>
        </header>
        {photos.length === 0 ? (
          <p className="empty-hint">Import jpg / png / heic images</p>
        ) : (
          <div className="library-list compact">
            {photos.map((p) => (
              <div key={p.id} className="library-item small">
                <div className="library-thumb tiny">
                  <img src={mediaUrl(p.path)} alt={p.name} />
                </div>
                <div className="library-item-info">
                  <p className="clip-name" title={p.name}>
                    {p.name}
                  </p>
                  <div className="item-actions">
                    <button className="btn-tiny" onClick={() => props.onAddPhoto(p)}>
                      + Timeline
                    </button>
                    <button
                      className="btn-tiny btn-danger"
                      onClick={() => props.onRemovePhoto(p.id)}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="media-library">
        <header className="library-header">
          <h2>Music</h2>
          <button className="btn-tiny" onClick={props.onImportMusic}>
            Import
          </button>
        </header>
        {audios.length === 0 ? (
          <p className="empty-hint">Import mp3 / wav / m4a tracks</p>
        ) : (
          <div className="library-list">
            {audios.map((a) => (
              <div key={a.id} className="library-item row">
                <span className="audio-icon"><AudioIcon size={18} /></span>
                <div className="library-item-info">
                  <p className="clip-name" title={a.name}>
                    {a.name}
                  </p>
                  <p className="clip-meta">
                    {Math.floor(a.duration / 60)}:
                    {String(Math.floor(a.duration % 60)).padStart(2, '0')}
                  </p>
                  <div className="item-actions">
                    <button className="btn-tiny" onClick={() => props.onAddAudio(a)}>
                      + Timeline
                    </button>
                    <button
                      className="btn-tiny btn-danger"
                      onClick={() => props.onRemoveAudio(a.id)}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </aside>
  )
}
