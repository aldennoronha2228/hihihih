import { useMemo } from 'react'
import {
  BoxGeometry, CatmullRomCurve3, CylinderGeometry, Group, Mesh, MeshStandardMaterial,
  SphereGeometry, TorusGeometry, TubeGeometry, Vector3,
} from 'three'

type Point3 = [number, number, number]

function box(group: Group, size: Point3, point: Point3, material: MeshStandardMaterial, rotation: Point3 = [0, 0, 0]) {
  const mesh = new Mesh(new BoxGeometry(...size), material)
  mesh.position.set(...point)
  mesh.rotation.set(...rotation)
  mesh.castShadow = true
  mesh.receiveShadow = true
  group.add(mesh)
  return mesh
}

function cylinder(group: Group, radius: number, height: number, point: Point3, material: MeshStandardMaterial,
                  rotation: Point3 = [0, 0, 0], segments = 28) {
  const mesh = new Mesh(new CylinderGeometry(radius, radius, height, segments), material)
  mesh.position.set(...point)
  mesh.rotation.set(...rotation)
  mesh.castShadow = true
  mesh.receiveShadow = true
  group.add(mesh)
  return mesh
}

function wire(group: Group, points: Point3[], color: string, radius = .00065) {
  const curve = new CatmullRomCurve3(points.map(point => new Vector3(...point)))
  const geometry = new TubeGeometry(curve, 28, radius, 6, false)
  const material = new MeshStandardMaterial({ color, roughness: .38, metalness: .08 })
  group.add(new Mesh(geometry, material))
}

/** Render-only product concept. Dimensions come from the project record; details marked concept are simplified. */
export function RobotCarConceptAssembly() {
  const model = useMemo(() => {
    const root = new Group()
    const chassis = new MeshStandardMaterial({ color: '#dce7ef', roughness: .38, metalness: .16, transparent: true, opacity: .72 })
    const pcb = new MeshStandardMaterial({ color: '#168254', roughness: .65, metalness: .08 })
    const solderMask = new MeshStandardMaterial({ color: '#b53b35', roughness: .7 })
    const rubber = new MeshStandardMaterial({ color: '#171c22', roughness: .92 })
    const wheelPlastic = new MeshStandardMaterial({ color: '#242a31', roughness: .65 })
    const metal = new MeshStandardMaterial({ color: '#aeb9c4', roughness: .3, metalness: .82 })
    const darkMetal = new MeshStandardMaterial({ color: '#485665', roughness: .38, metalness: .72 })
    const black = new MeshStandardMaterial({ color: '#11151a', roughness: .56, metalness: .15 })
    const blue = new MeshStandardMaterial({ color: '#3277bd', roughness: .42, metalness: .25 })
    const gold = new MeshStandardMaterial({ color: '#c6a153', roughness: .3, metalness: .72 })
    const chip = new MeshStandardMaterial({ color: '#171b20', roughness: .6, metalness: .12 })
    const sonarCan = new MeshStandardMaterial({ color: '#b8c2cb', roughness: .28, metalness: .75 })

    // 160 x 100 x 3 mm custom chassis envelope; the hole pattern is illustrative.
    box(root, [.16, .003, .1], [0, .024, 0], chassis)
    for (const x of [-.068, .068]) for (const z of [-.038, .038]) {
      const washer = new Mesh(new TorusGeometry(.0021, .00055, 6, 14), gold)
      washer.rotation.x = Math.PI / 2
      washer.position.set(x, .0258, z)
      root.add(washer)
      cylinder(root, .0013, .003, [x, .027, z], metal)
    }
    // Motor brackets are custom mounting concepts, not purchased component models.
    for (const side of [-1, 1]) {
      box(root, [.024, .008, .012], [side * .048, .030, -.015], darkMetal)
      box(root, [.002, .014, .018], [side * .060, .033, -.015], darkMetal)
    }

    // Pololu #1425 wheel pair: 70 mm diameter x 8 mm wide, 3 mm D-shaft fit.
    for (const side of [-1, 1]) {
      const wheel = new Group()
      wheel.position.set(side * .084, .035, -.015)
      wheel.rotation.z = Math.PI / 2
      root.add(wheel)
      cylinder(wheel, .035, .008, [0, 0, 0], rubber, [0, 0, 0], 48)
      cylinder(wheel, .026, .0088, [0, 0, 0], wheelPlastic, [0, 0, 0], 36)
      cylinder(wheel, .0058, .0092, [0, 0, 0], metal, [0, 0, 0], 20)
      for (let spoke = 0; spoke < 5; spoke++) {
        const angle = spoke * Math.PI * 2 / 5
        box(wheel, [.006, .0094, .019], [Math.cos(angle) * .014, 0, Math.sin(angle) * .014], wheelPlastic,
          [0, -angle, 0])
      }
      for (let rib = 0; rib < 22; rib++) {
        const angle = rib * Math.PI * 2 / 22
        box(wheel, [.0084, .0014, .0022], [Math.cos(angle) * .0343, 0, Math.sin(angle) * .0343], rubber,
          [0, -angle, 0])
      }
    }

    // Two Pololu #992 gearmotor concepts. Published envelope and shaft are retained;
    // surface details are simplified, so these are not manufacturer CAD exports.
    for (const side of [-1, 1]) {
      const x = side * .060
      box(root, [.025, .010, .012], [x, .032, -.015], darkMetal)
      cylinder(root, .0048, .013, [side * .041, .032, -.015], metal, [0, 0, Math.PI / 2], 24)
      cylinder(root, .002, .009, [side * .077, .035, -.015], metal, [0, 0, Math.PI / 2], 16)
      box(root, [.012, .009, .010], [side * .0665, .032, -.015], gold)
    }

    // Arduino Uno R3 outline: 68.58 x 53.34 x 1.6 mm. Component details are concept geometry.
    const uno = new Group()
    uno.position.set(-.022, .030, .026)
    root.add(uno)
    box(uno, [.06858, .0016, .05334], [0, 0, 0], pcb)
    box(uno, [.0345, .004, .0096], [.003, .0028, .002], chip)
    box(uno, [.012, .010, .016], [-.028, .0055, .003], metal)
    box(uno, [.009, .006, .010], [-.027, .0045, -.018], black)
    box(uno, [.012, .003, .008], [.027, .003, -.016], black)
    for (let pin = 0; pin < 14; pin++) {
      const x = -.022 + pin * .00254
      box(uno, [.0011, .006, .0011], [x, .0037, .024], gold)
      box(uno, [.0011, .006, .0011], [x, .0037, -.024], gold)
    }
    for (const x of [-.030, .030]) for (const z of [-.021, .021]) {
      cylinder(uno, .0016, .0007, [x, .0012, z], metal, [0, 0, 0], 12)
    }

    // L293D on an explicitly conceptual carrier; the carrier footprint is not selected hardware.
    const driver = new Group()
    driver.position.set(.038, .028, .008)
    root.add(driver)
    box(driver, [.038, .0016, .024], [0, 0, 0], solderMask)
    box(driver, [.0193, .0033, .0076], [0, .00245, 0], chip)
    for (let row = -3.5; row <= 3.5; row++) for (const side of [-1, 1]) {
      cylinder(driver, .00055, .004, [side * .0108, -.0008, row * .00254], gold, [0, 0, 0], 8)
    }

    // HC-SR04-compatible module: 45 x 20 mm board, two 16 mm transducer cans.
    const sonar = new Group()
    sonar.position.set(0, .047, .060)
    root.add(sonar)
    box(sonar, [.045, .020, .0016], [0, 0, 0], pcb)
    for (const x of [-.015, .015]) {
      cylinder(sonar, .008, .0134, [x, 0, .0075], sonarCan, [Math.PI / 2, 0, 0], 32)
      cylinder(sonar, .0068, .0008, [x, 0, .0143], darkMetal, [Math.PI / 2, 0, 0], 32)
    }
    for (let pin = 0; pin < 4; pin++) box(sonar, [.001, .007, .001], [-.016 + pin * .004, -.013, 0], gold)

    // Four-AA pack concept only: cell brand and holder footprint remain unselected.
    box(root, [.065, .002, .052], [0, .0265, -.027], black)
    box(root, [.0015, .014, .052], [-.0315, .034, -.027], black)
    box(root, [.0015, .014, .052], [.0315, .034, -.027], black)
    for (let cell = 0; cell < 4; cell++) {
      const x = (cell - 1.5) * .015
      const y = .035
      const z = -.027
      cylinder(root, .00725, .0505, [x, y, z], blue, [Math.PI / 2, 0, 0], 28)
      for (const end of [-1, 1]) {
        const endZ = z + end * .0256
        cylinder(root, .0058, .0007, [x, y, endZ], metal, [Math.PI / 2, 0, 0], 18)
      }
      const positiveEnd = cell % 2 === 0 ? 1 : -1
      cylinder(root, .0032, .001, [x, y, z + positiveEnd * .0261], metal, [Math.PI / 2, 0, 0], 16)
    }

    // Pololu #951 caster concept, with its sourced 9.525 mm metal ball.
    box(root, [.019, .004, .014], [0, .0215, -.044], darkMetal)
    box(root, [.004, .011, .010], [-.006, .014, -.044], metal)
    box(root, [.004, .011, .010], [.006, .014, -.044], metal)
    const casterBall = new Mesh(new SphereGeometry(.0047625, 24, 16), metal)
    casterBall.position.set(0, .0047625, -.044)
    casterBall.castShadow = true
    root.add(casterBall)

    // Routed concept harness; pin-accurate circuit wires remain in the 2D circuit view.
    wire(root, [[-.003, .035, .032], [-.005, .047, .044], [-.012, .050, .052]], '#ef4444')
    wire(root, [[.001, .034, .032], [.006, .044, .043], [.008, .050, .052]], '#111827')
    wire(root, [[-.003, .034, .034], [.012, .043, .028], [.028, .036, .018]], '#2563eb')
    wire(root, [[-.001, .034, .034], [.014, .046, .030], [.031, .037, .020]], '#f97316')
    wire(root, [[-.023, .038, -.020], [.004, .055, -.030], [.030, .036, .007]], '#ef4444')
    wire(root, [[-.016, .037, -.020], [.006, .052, -.034], [.032, .035, .006]], '#111827')
    wire(root, [[.006, .034, .012], [.022, .042, -.002], [.032, .034, -.010]], '#eab308')
    wire(root, [[.010, .034, .012], [.024, .044, -.004], [.034, .034, -.010]], '#22c55e')
    wire(root, [[.014, .034, .012], [.028, .045, -.004], [.036, .035, -.010]], '#06b6d4')

    root.position.y = -.0015
    return root
  }, [])

  return <primitive object={model} dispose={null} />
}
