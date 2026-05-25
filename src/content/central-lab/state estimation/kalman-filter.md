---
title: Kalman Filter
description: Optimal linear estimation under Gaussian noise — the workhorse of navigation.
date: 2026-05-17
tags:
  - estimation
  - filtering
  - linear-systems
public: true
---

## Overview

The Kalman filter provides the minimum-mean-square-error (MMSE) estimate of the state
$\mathbf{x}_k$ given a sequence of measurements $\mathbf{z}_{1:k}$, under the assumption
that both process and measurement noise are Gaussian and that the system is linear.

## State-space model

$$
\mathbf{x}_k = \mathbf{F}_{k-1} \mathbf{x}_{k-1} + \mathbf{G}_{k-1} \mathbf{u}_{k-1} + \mathbf{w}_{k-1}
$$

$$
\mathbf{z}_k = \mathbf{H}_k \mathbf{x}_k + \mathbf{v}_k
$$

where $\mathbf{w}_{k-1} \sim \mathcal{N}(\mathbf{0}, \mathbf{Q}_{k-1})$ and
$\mathbf{v}_k \sim \mathcal{N}(\mathbf{0}, \mathbf{R}_k)$.

## Prediction step

$$
\hat{\mathbf{x}}_{k|k-1} = \mathbf{F}_{k-1} \hat{\mathbf{x}}_{k-1|k-1}
$$

$$
\mathbf{P}_{k|k-1} = \mathbf{F}_{k-1} \mathbf{P}_{k-1|k-1} \mathbf{F}_{k-1}^\top + \mathbf{Q}_{k-1}
$$

## Update step

$$
\mathbf{K}_k = \mathbf{P}_{k|k-1} \mathbf{H}_k^\top \bigl(\mathbf{H}_k \mathbf{P}_{k|k-1} \mathbf{H}_k^\top + \mathbf{R}_k\bigr)^{-1}
$$

$$
\hat{\mathbf{x}}_{k|k} = \hat{\mathbf{x}}_{k|k-1} + \mathbf{K}_k (\mathbf{z}_k - \mathbf{H}_k \hat{\mathbf{x}}_{k|k-1})
$$

$$
\mathbf{P}_{k|k} = (\mathbf{I} - \mathbf{K}_k \mathbf{H}_k) \mathbf{P}_{k|k-1}
$$

## See also

- [[Extended Kalman Filter]]
- [[Unscented Kalman Filter]]
