/** Scratch probe: what can Rapier 0.21 actually set? Not part of the suite. */
import RAPIER from '@dimforge/rapier3d-compat'
await RAPIER.init()

const world = new RAPIER.World({ x: 0, y: 0, z: -9.80665 })
const I = { x: 0.0044, y: 0.0044, z: 0.0125 }
const com = { x: 0, y: 0, z: 0 }
const frame = { x: 0, y: 0, z: 0, w: 1 }
const show = (label: string, b: RAPIER.RigidBody) =>
  console.log(`${label.padEnd(52)} mass=${b.mass().toFixed(6)} I=${JSON.stringify(b.principalInertia())}`)

// A. 5-arg setAdditionalMassProperties on an empty body.
const a = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic())
a.setAdditionalMassProperties(0.7, com, I, frame, true)
show('A empty body + 5-arg addlMassProps', a)

// B. Same, but followed by recomputeMassPropertiesFromColliders (what airframe.ts does).
const b = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic())
b.setAdditionalMassProperties(0.7, com, I, frame, true)
b.recomputeMassPropertiesFromColliders()
show('B A + recomputeMassPropertiesFromColliders', b)

// C. Colliders carrying mass AND additional mass properties -> additive or overriding?
const c = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic())
world.createCollider(RAPIER.ColliderDesc.cuboid(0.1, 0.1, 0.01).setDensity(500), c)
c.setAdditionalMassProperties(0.7, com, I, frame, true)
c.recomputeMassPropertiesFromColliders()
show('C 0.65kg colliders + 0.7kg additional', c)

// D. setAdditionalMass (mass only).
const d = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic())
d.setAdditionalMass(0.7, true)
d.recomputeMassPropertiesFromColliders()
show('D empty body + setAdditionalMass(0.7)', d)

// E. Does a zero-density collider give the body exactly zero mass?
const e = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic())
world.createCollider(RAPIER.ColliderDesc.cuboid(0.1, 0.1, 0.01).setDensity(0), e)
e.recomputeMassPropertiesFromColliders()
show('E zero-density collider', e)

// F. ColliderDesc.setMass
const f = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic())
world.createCollider(RAPIER.ColliderDesc.cuboid(0.1, 0.1, 0.01).setMass(0.7), f)
f.recomputeMassPropertiesFromColliders()
show('F ColliderDesc.setMass(0.7)', f)

// G. Does the *hierarchy* keep the additional properties across a step?
a.setLinvel({ x: 1, y: 0, z: 0 }, true)
for (let i = 0; i < 10; i++) world.step()
show('G A after 10 world steps', a)

// H. What does the world report as the body's effective world inertia?
console.log('\nworld.bodyInertia / effective helpers:')
const w: Record<string, unknown> = world as unknown as Record<string, unknown>
console.log(Object.getOwnPropertyNames(Object.getPrototypeOf(world)).filter(n => /inertia|mass|Mass/i.test(n)).join(', '))
console.log('angularDamping default', b.angularDamping(), 'linearDamping', b.linearDamping())