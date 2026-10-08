import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import '@modules/base'
import { registry } from '@core/module-engine'
import { escapeProps, publishPage } from '@core/publisher'
import { buildTemplateRenderContext, resolveDynamicProps } from '@core/templates'
import { importHtml } from '@core/htmlImport'
import { normalizeCmsMediaAsset } from '@core/persistence/cmsMedia'
import { primeCmsMediaAssetCache, refreshCmsMediaAssetCache } from '@admin/pages/media/hooks/useCmsMediaAssetByPath'
import { useEditorStore } from '@site/store/store'
import { DEFAULT_SITE_VISITOR_PREFERENCES } from '@core/visitor-preferences-schema'
import { makeNode, makePage, makeSite } from '../fixtures'

const definition = registry.getOrThrow('base.video')
const videoUrl = '/video-title.webm'
const poster = '/video-title-poster.jpg'
const originalSite = useEditorStore.getState().site

beforeEach(() => {
  for (const path of [videoUrl, poster]) {
    primeCmsMediaAssetCache(normalizeCmsMediaAsset({
      id: path, filename: path, mimeType: path.endsWith('.webm') ? 'video/webm' : 'image/jpeg',
      sizeBytes: 1, publicPath: path, uploadedByUserId: null, createdAt: '',
    }))
  }
})
afterEach(() => {
  cleanup()
  refreshCmsMediaAssetCache()
  useEditorStore.setState({ site: originalSite })
})

function players(authored: Record<string, unknown>) {
  const props = { ...definition.defaults, videoUrl, ...authored }
  const wrapper = document.createElement('div')
  wrapper.innerHTML = definition.render(escapeProps(props, definition.schema), []).html
  const canvas = render(React.createElement(definition.component, { nodeId: 'video', isSelected: false, props }))
  return [wrapper.querySelector('video, iframe')!, canvas.container.querySelector('video, iframe')!]
}

describe('native video titles and HTML attributes', () => {
  it('resolves language catalogue titles and ARIA labels in publication and canvas without changing authored tokens', () => {
    const node = makeNode({ id: 'video', moduleId: 'base.video', props: {
      videoUrl, title: '{site.translations.video.title}',
      htmlAttributes: { 'aria-label': '{site.translations.video.title}' },
    } })
    const page = makePage({ language: 'de', nodes: {
      root: makeNode({ id: 'root', moduleId: 'base.body', children: ['video'] }), video: node,
    } })
    const messages = { it: 'Persone e infrastruttura', de: 'Menschen & Infrastruktur "vor Ort"' }
    const files = Object.entries(messages).map(([language, title]) => ({
      id: language, path: `locales/${language}.json`, type: 'config' as const,
      content: JSON.stringify({ language, messages: { video: { title } } }), createdAt: 0, updatedAt: 0,
    }))
    const site = makeSite({ pages: [page], files, settings: {
      shortcuts: {}, localization: { catalogues: files.map(file => ({ language: file.id, fileId: file.id })) },
    } })
    for (const [language, title] of Object.entries(messages)) {
      const localizedPage = { ...page, language }
      const html = publishPage(localizedPage, site, registry).html
      const wrapper = document.createElement('div')
      wrapper.innerHTML = html
      const published = wrapper.querySelector('video')!
      const props = resolveDynamicProps({ ...definition.defaults, ...node.props }, undefined, buildTemplateRenderContext(localizedPage, site, undefined))
      const canvas = render(React.createElement(definition.component, { nodeId: node.id, isSelected: false, props }))
      for (const player of [published, canvas.container.querySelector('video')!]) {
        expect(player.getAttribute('title')).toBe(title)
        expect(player.getAttribute('aria-label')).toBe(title)
      }
      expect(html).not.toContain('{site.translations')
      expect(html).not.toContain('locales/')
      canvas.unmount()
    }
    expect(node.props.title).toBe('{site.translations.video.title}')
  })

  it('escapes authored titles and safe attributes once, and rejects executable or runtime attributes', () => {
    const title = 'A "quoted" & <local> video'
    for (const player of players({ title, htmlAttributes: {
      'aria-label': title, 'data-purpose': 'safe "value"', onclick: 'alert(1)',
      srcdoc: '<script>alert(1)</script>', 'data-instatic-decorative-src': '/forged.webm',
    } })) {
      expect(player.getAttribute('title')).toBe(title)
      expect(player.getAttribute('aria-label')).toBe(title)
      expect(player.getAttribute('data-purpose')).toBe('safe "value"')
      expect(player.hasAttribute('onclick')).toBe(false)
      expect(player.hasAttribute('srcdoc')).toBe(false)
      expect(player.hasAttribute('data-instatic-decorative-src')).toBe(false)
      expect(player.children).toHaveLength(0)
    }
  })

  it.each([videoUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'])('keeps missing and empty titles neutral: %s', (source) => {
    expect(definition.defaults.title).toBe('')
    for (const title of [undefined, '']) {
      for (const player of players({ videoUrl: source, ...(title === undefined ? {} : { title }) })) {
        expect(player.hasAttribute('title')).toBe(false)
        expect(player.outerHTML).not.toContain('YouTube video')
      }
    }
  })

  it.each(['', poster])('keeps YouTube titles and ARIA attributes on the lazy player with poster %s', (image) => {
    for (const player of players({
      videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', poster: image, title: 'My "demo"',
      htmlAttributes: { 'aria-label': 'Translated demo', 'data-purpose': 'player', loading: 'eager', src: '/forged.webm', title: 'forged' },
    })) {
      expect(player.tagName).toBe('IFRAME')
      expect(player.getAttribute('title')).toBe('My "demo"')
      expect(player.getAttribute('aria-label')).toBe('Translated demo')
      expect(player.getAttribute('loading')).toBe('lazy')
      expect(player.getAttribute('src')).toStartWith('https://www.youtube.com/embed/dQw4w9WgXcQ')
      expect(player.parentElement?.getAttribute('data-purpose')).not.toBe('player')
    }
  })

  it('protects decorative loading and ARIA policy while preserving its authored title', () => {
    useEditorStore.setState({ site: makeSite({ settings: { shortcuts: {}, visitorPreferences: DEFAULT_SITE_VISITOR_PREFERENCES } }) })
    for (const player of players({
      playbackRole: 'decorative', muted: true, controls: false, playsinline: true, autoplay: true,
      title: 'People & infrastructure', htmlAttributes: {
        'aria-hidden': 'false', preload: 'auto', src: '/forged.webm', autoplay: '', controls: '',
        'data-instatic-decorative-src': '/forged.webm', 'aria-label': 'Authored label',
      },
    })) {
      expect(player.getAttribute('title')).toBe('People & infrastructure')
      expect(player.getAttribute('aria-hidden')).toBe('true')
      expect(player.getAttribute('preload')).toBe('none')
      expect(player.getAttribute('data-instatic-decorative-src')).toBe(videoUrl)
      expect(player.hasAttribute('src')).toBe(false)
      expect(player.hasAttribute('autoplay')).toBe(false)
      expect(player.hasAttribute('controls')).toBe(false)
    }
  })

  it('imports independent authored title and ARIA label without inventing a missing title', () => {
    const imported = importHtml('<video src="/video-title.webm" title="Authored title" aria-label="Accessible label" preload="none" controls data-purpose="player"></video>')
    const node = Object.values(imported.nodes).find(node => node.moduleId === 'base.video')!
    expect(node.props.title).toBe('Authored title')
    expect(node.props.htmlAttributes).toEqual({ 'aria-label': 'Accessible label', 'data-purpose': 'player' })
    for (const player of players(node.props)) {
      expect(player.getAttribute('title')).toBe('Authored title')
      expect(player.getAttribute('aria-label')).toBe('Accessible label')
      expect(player.getAttribute('preload')).toBe('none')
      expect(player.hasAttribute('controls')).toBe(true)
    }
    const unlabelled = importHtml('<video src="/clip.webm"></video>')
    const video = Object.values(unlabelled.nodes).find(node => node.moduleId === 'base.video')!
    expect(video.props.title).toBe('')
  })

  it('preserves ordinary authored aria-hidden and the canvas focus owner', () => {
    const props = { ...definition.defaults, videoUrl, htmlAttributes: { 'aria-hidden': 'true', tabindex: '-1' } }
    const canvas = render(React.createElement(definition.component, { nodeId: 'video', isSelected: false, nodeWrapperProps: { tabIndex: 0 }, props }))
    const player = canvas.container.querySelector('video')!
    expect(player.getAttribute('aria-hidden')).toBe('true')
    expect(player.tabIndex).toBe(0)
  })
})
