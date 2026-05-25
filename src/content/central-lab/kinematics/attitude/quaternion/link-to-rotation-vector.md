---
title: Link to Rotation Vector
description: relationship between quaternion and  rotation vector (Rodrigues formula)
date: 2026-05-25
tags:
  - attitude
  - representation
public: true
---
## quaternion to matrix
$$
{F}(q) = |q|^2 \; I + 2 \; q_{0} \; [\textbf{q}\times] + [\textbf{q}\times]^{2}
$$
### 항법에의 적용
unit quaternion.
$$
R_{b/a} = {F}(q_{b/a}) = I + 2 \; q_{0} \; [\textbf{q}\times] + [\textbf{q}\times]^{2}
$$