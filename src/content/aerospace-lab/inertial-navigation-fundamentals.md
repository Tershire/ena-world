---
title: "Inertial Navigation System Fundamentals"
description: "Core principles of INS: IMU modelling, mechanization equations, and error propagation in strapdown systems."
date: 2025-12-01
tags: ["INS", "IMU", "strapdown", "navigation"]
draft: false
---

## What is an INS?

An **Inertial Navigation System (INS)** computes position, velocity, and attitude purely from onboard sensor measurements — no external signals required. The workhorse is the **Inertial Measurement Unit (IMU)**, which bundles three accelerometers and three gyroscopes mounted along orthogonal axes.

Because the system is self-contained, INS is immune to jamming and works in GPS-denied environments: underground, underwater, in deep space, or in contested airspace. The cost is a fundamental flaw — errors integrate over time, so position drift grows without bound without external correction.

## IMU Sensor Models

### Accelerometers

A triad of accelerometers measures **specific force** $f^b$ in the body frame:

$$
\tilde{f}^b = f^b + b_a + n_a
$$

where $b_a$ is a slowly-varying bias (modelled as a random walk) and $n_a$ is white noise (vibration-induced). The accelerometer does **not** measure gravitational acceleration directly — gravity must be removed via the navigation equations.

### Gyroscopes

MEMS gyros measure angular rate $\omega^b_{ib}$ of the body with respect to the inertial frame, expressed in body coordinates:

$$
\tilde{\omega}^b_{ib} = \omega^b_{ib} + b_g + n_g
$$

The bias $b_g$ is the dominant error source in low-cost MEMS gyros. Thermal variations cause it to drift by tens of deg/hr.

## Strapdown Mechanization

Modern aircraft use **strapdown** (strapped-down) INS: the IMU is rigidly bolted to the airframe instead of sitting on a gimbal-stabilized platform. The attitude must be maintained in software.

The mechanization equations propagate three quantities simultaneously:

### 1. Attitude Update

Attitude is tracked as a quaternion $\mathbf{q}^n_b$ (navigation-to-body). The differential equation is:

$$
\dot{\mathbf{q}}^n_b = \frac{1}{2}\mathbf{q}^n_b \otimes \boldsymbol{\Omega}^b_{nb}
$$

where $\boldsymbol{\Omega}^b_{nb}$ is the angular velocity of the body relative to the navigation frame. In discrete time, the gyro measurement is integrated using the rotation vector approach to avoid first-order drift from naive Euler integration.

### 2. Velocity Update

Specific force is rotated from body to navigation frame and integrated:

$$
\dot{\mathbf{v}}^n = C^n_b \, f^b + \mathbf{g}^n - (2\boldsymbol{\omega}^n_{ie} + \boldsymbol{\omega}^n_{en}) \times \mathbf{v}^n
$$

The Coriolis and transport-rate terms $(2\boldsymbol{\omega}_{ie} + \boldsymbol{\omega}_{en}) \times \mathbf{v}^n$ are small for short flights but accumulate over time in precision applications.

### 3. Position Update

Position in curvilinear coordinates $(L, \lambda, h)$ — latitude, longitude, altitude — follows from velocity:

$$
\dot{L} = \frac{v_N}{R_M + h}, \quad \dot{\lambda} = \frac{v_E}{(R_N + h)\cos L}, \quad \dot{h} = v_D
$$

$R_M$ and $R_N$ are the meridian and normal radii of curvature of the WGS-84 ellipsoid.

## Error Propagation

INS errors obey a linear state-space model. The 15-state error model tracks:

| State | Symbol | Dimension |
|-------|--------|-----------|
| Attitude error | $\delta\boldsymbol{\psi}$ | 3 |
| Velocity error | $\delta\mathbf{v}$ | 3 |
| Position error | $\delta\mathbf{p}$ | 3 |
| Accelerometer bias | $\delta b_a$ | 3 |
| Gyro bias | $\delta b_g$ | 3 |

The error dynamics are:

$$
\dot{\mathbf{x}} = F\mathbf{x} + G\mathbf{w}
$$

where $F$ is the system matrix (contains rotation matrices, Earth-rate terms, gravity gradient), $G$ is the noise-coupling matrix, and $\mathbf{w}$ is zero-mean white noise.

For unaided INS, position error grows roughly as:

$$
\sigma_p(t) \approx \frac{1}{2} \sigma_{b_a} t^2 + \frac{1}{\sqrt{3}} \sigma_{b_g} \|\mathbf{v}\| t^2
$$

A gyro bias of 1 deg/hr produces roughly **1 nautical mile per hour** of position drift — the standard figure of merit for tactical-grade INS.

## GNSS/INS Integration

A loosely-coupled GNSS/INS Kalman filter fuses the 15-state INS error model with GNSS position and velocity measurements:

$$
\mathbf{z}_k = H\mathbf{x}_k + \boldsymbol{\nu}_k
$$

$$
H = \begin{bmatrix} \mathbf{0}_{3\times6} & I_3 & \mathbf{0}_{3\times6} \end{bmatrix}
$$

The filter estimates bias states continuously, feeding corrections back to the mechanization. During GNSS outages the INS coasts, accumulating error at the rate determined by residual bias after calibration.

## Next Steps

The natural extensions from this baseline are:

- **Tightly-coupled integration** — use raw pseudoranges instead of GNSS position fixes, maintaining lock through partial satellite visibility
- **Visual-inertial odometry (VIO)** — fuse camera feature tracks with IMU to bound drift without GNSS
- **Magnetic aiding** — use magnetometer + world magnetic model for heading during prolonged GPS denial
- **Barometric altitude aiding** — bound vertical channel divergence cheaply
