---
title: Doppler Velocity Log
description: Acoustic Doppler sensing for underwater velocity estimation — dead reckoning's best friend.
date: 2026-05-17
tags:
  - acoustics
  - DVL
  - dead-reckoning
  - underwater
public: true
---

## What is a DVL?

A Doppler Velocity Log (DVL) is an acoustic sensor that measures the velocity of an
underwater vehicle relative to the seafloor (or water column) by exploiting the
Doppler shift of reflected acoustic pulses.

## Operating principle

Four acoustic beams are transmitted at oblique angles. Each beam's Doppler shift $f_d$
relates to the radial velocity component $v_r$ as:

$$
f_d = \frac{2 v_r f_0}{c}
$$

where $f_0$ is the transmit frequency and $c \approx 1500\ \mathrm{m/s}$ is the
speed of sound in seawater.

Combining the four beams (Janus configuration) resolves the 3-D velocity vector
$[v_x,\ v_y,\ v_z]$ in the sensor frame.

## Dead reckoning with DVL + IMU

Integrating DVL velocity with an IMU attitude estimate gives a Dead Reckoning (DR)
position:

$$
\mathbf{p}_{k} = \mathbf{p}_{k-1} + \mathbf{R}_{k-1}^{b \to n}\, \mathbf{v}^b_k \,\Delta t
$$

Error accumulates over time → typically fused with USBL or LBL fixes.

## See also

- [[LBL Acoustic Positioning]]
- [[Underwater SLAM]]
