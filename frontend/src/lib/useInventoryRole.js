import { useEffect, useState } from "react";
import axios from "axios";

/**
 * Hook to get the current user's inventory role.
 * Always fetches from the API — no local cache so stale roles never block features.
 */
export function useInventoryRole() {
  const [inventoryRole, setInventoryRole] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Clean up any old cached role keys to avoid confusion
    localStorage.removeItem("inventoryRole");
    const inventoryId = localStorage.getItem("activeInventoryId");
    if (inventoryId) {
      localStorage.removeItem(`inventoryRole_${inventoryId}`);
    }

    const fetchInventoryRole = async () => {
      try {
        const token = localStorage.getItem("token");
        const invId = localStorage.getItem("activeInventoryId");

        if (!token || !invId) {
          setLoading(false);
          return;
        }

        const API = process.env.NEXT_PUBLIC_API_URL || "/api";
        const { data } = await axios.get(
          `${API}/auth/inventory-role?inventoryId=${invId}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );

        if (data.inventoryRole) {
          setInventoryRole(data.inventoryRole);
        }
      } catch (err) {
        console.error("Error getting inventory role:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchInventoryRole();
  }, []);

  return { inventoryRole, loading };
}

export function getInventoryRoleFromStorage() {
  // No longer cached — callers should use the hook in components
  return null;
}

export function isRevisor() {
  return false; // Use useInventoryRole() hook instead
}

export function canManageSpaces() {
  return false; // Use useInventoryRole() hook instead
}
