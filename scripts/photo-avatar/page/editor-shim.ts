// What apps/editor/lib's photo modules take from '@pascal-app/editor', from the modules themselves
// (the package's index would bundle the whole editor into the bench page). A module the app's photo
// code starts importing from must be added here.
export * from '../../../packages/editor/src/components/editor/first-person/face-points'
export { type Point as FacePoint } from '../../../packages/editor/src/components/editor/first-person/face-points'
export * from '../../../packages/editor/src/components/editor/first-person/photo-avatar/avatar-job'
export * from '../../../packages/editor/src/components/editor/first-person/photo-avatar/build-client'
export * from '../../../packages/editor/src/components/editor/first-person/photo-avatar/capture-guide'
export { eyesShut } from '../../../packages/editor/src/components/editor/first-person/photo-avatar/eyes'
export * from '../../../packages/editor/src/components/editor/first-person/photo-avatar/segment'
export * from '../../../packages/editor/src/components/editor/first-person/photo-avatar/skin-map'
