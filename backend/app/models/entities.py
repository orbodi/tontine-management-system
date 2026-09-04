"""Modèles SQLAlchemy — miroir de src/types.ts AppData."""
from __future__ import annotations

from sqlalchemy import Boolean, Float, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class Agence(Base):
    __tablename__ = "agences"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    code: Mapped[str] = mapped_column(String, unique=True)
    nom: Mapped[str] = mapped_column(String)
    adresse: Mapped[str | None] = mapped_column(String, nullable=True)
    telephone: Mapped[str | None] = mapped_column(String, nullable=True)
    chef_employe_id: Mapped[str | None] = mapped_column(String, nullable=True)
    actif: Mapped[bool] = mapped_column(Boolean, default=True)


class Zone(Base):
    __tablename__ = "zones"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    agence_id: Mapped[str] = mapped_column(String, index=True)
    code: Mapped[str] = mapped_column(String, unique=True)
    nom: Mapped[str | None] = mapped_column(String, nullable=True)
    actif: Mapped[bool] = mapped_column(Boolean, default=True)


class CompteZoneTontine(Base):
    __tablename__ = "comptes_zone_tontine"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    zone_id: Mapped[str] = mapped_column(String, unique=True)
    cumul_manquant: Mapped[float] = mapped_column(Float, default=0)
    cumul_surplus: Mapped[float] = mapped_column(Float, default=0)
    actif: Mapped[bool] = mapped_column(Boolean, default=True)


class JourneeCompteZone(Base):
    __tablename__ = "journees_compte_zone"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    compte_zone_id: Mapped[str] = mapped_column(String, index=True)
    zone_id: Mapped[str] = mapped_column(String, index=True)
    date: Mapped[str] = mapped_column(String, index=True)
    montant_reel: Mapped[float] = mapped_column(Float, default=0)
    montant_theorique: Mapped[float] = mapped_column(Float, default=0)
    ecart: Mapped[float] = mapped_column(Float, default=0)
    statut: Mapped[str] = mapped_column(String, default="en_cours")
    cloturee: Mapped[bool] = mapped_column(Boolean, default=False)
    date_saisie_reel: Mapped[str] = mapped_column(String)
    date_cloture: Mapped[str | None] = mapped_column(String, nullable=True)
    operateur_id: Mapped[str] = mapped_column(String)
    operateur_nom: Mapped[str] = mapped_column(String)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)


class AjustementCompteZone(Base):
    __tablename__ = "ajustements_compte_zone"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    compte_zone_id: Mapped[str] = mapped_column(String)
    zone_id: Mapped[str] = mapped_column(String)
    date: Mapped[str] = mapped_column(String)
    type: Mapped[str] = mapped_column(String)
    montant: Mapped[float] = mapped_column(Float)
    motif: Mapped[str] = mapped_column(Text)
    admin_id: Mapped[str] = mapped_column(String)
    admin_nom: Mapped[str] = mapped_column(String)
    cumul_avant: Mapped[float] = mapped_column(Float)
    cumul_apres: Mapped[float] = mapped_column(Float)


class Employe(Base):
    __tablename__ = "employes"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    nom_complet: Mapped[str] = mapped_column(String)
    identifiant: Mapped[str] = mapped_column(String, unique=True, index=True)
    mot_de_passe_hash: Mapped[str] = mapped_column(String)
    role: Mapped[str] = mapped_column(String)
    agence_id: Mapped[str] = mapped_column(String, index=True)
    droits_json: Mapped[str] = mapped_column(Text, default="[]")
    telephone: Mapped[str | None] = mapped_column(String, nullable=True)
    email: Mapped[str | None] = mapped_column(String, nullable=True)
    adresse: Mapped[str | None] = mapped_column(String, nullable=True)
    piece_identite: Mapped[str | None] = mapped_column(String, nullable=True)
    date_embauche: Mapped[str] = mapped_column(String)
    actif: Mapped[bool] = mapped_column(Boolean, default=True)


class Client(Base):
    __tablename__ = "clients"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    # N° tontine ZZxxxx — absent pour un client banque seul (agence, sans zone).
    code_client: Mapped[str | None] = mapped_column(String, unique=True, nullable=True)
    agence_id: Mapped[str] = mapped_column(String, index=True)
    zone_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    ordre_zone: Mapped[int | None] = mapped_column(Integer, nullable=True)
    nom: Mapped[str] = mapped_column(String)
    prenom: Mapped[str] = mapped_column(String)
    sexe: Mapped[str] = mapped_column(String)
    telephone: Mapped[str] = mapped_column(String)
    email: Mapped[str | None] = mapped_column(String, nullable=True)
    profession: Mapped[str | None] = mapped_column(String, nullable=True)
    adresse: Mapped[str | None] = mapped_column(String, nullable=True)
    piece_identite: Mapped[str | None] = mapped_column(String, nullable=True)
    date_inscription: Mapped[str] = mapped_column(String)
    actif: Mapped[bool] = mapped_column(Boolean, default=True)
    ordre_banque: Mapped[int | None] = mapped_column(Integer, nullable=True)
    code_client_banque: Mapped[str | None] = mapped_column(String, nullable=True)
    origine_tontine: Mapped[str] = mapped_column(String, default="nouveau")


class Carnet(Base):
    __tablename__ = "carnets"
    __table_args__ = (UniqueConstraint("numero", "type_carnet", name="uq_carnet_numero_type"),)
    id: Mapped[str] = mapped_column(String, primary_key=True)
    client_id: Mapped[str] = mapped_column(String, index=True)
    numero: Mapped[str] = mapped_column(String, index=True)
    zone_id: Mapped[str] = mapped_column(String)
    agence_id: Mapped[str] = mapped_column(String)
    type_carnet: Mapped[str] = mapped_column(String)
    mise: Mapped[float] = mapped_column(Float)
    frequence: Mapped[str] = mapped_column(String)
    mises_par_cycle: Mapped[int] = mapped_column(Integer, default=31)
    cycle_actuel: Mapped[int] = mapped_column(Integer, default=1)
    date_ouverture: Mapped[str] = mapped_column(String)
    verrouille: Mapped[bool] = mapped_column(Boolean, default=False)
    retrait_active_par_admin: Mapped[bool] = mapped_column(Boolean, default=True)
    actif: Mapped[bool] = mapped_column(Boolean, default=True)
    reprise_papier: Mapped[bool] = mapped_column(Boolean, default=False)


class Mise(Base):
    __tablename__ = "mises"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    carnet_id: Mapped[str] = mapped_column(String, index=True)
    cycle: Mapped[int] = mapped_column(Integer)
    nombre_mises: Mapped[int] = mapped_column(Integer)
    montant: Mapped[float] = mapped_column(Float)
    date: Mapped[str] = mapped_column(String)


class Compte(Base):
    __tablename__ = "comptes"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    client_id: Mapped[str] = mapped_column(String, index=True)
    type: Mapped[str] = mapped_column(String)
    numero: Mapped[str] = mapped_column(String, unique=True)
    solde: Mapped[float] = mapped_column(Float, default=0)
    date_ouverture: Mapped[str] = mapped_column(String)
    verrouille: Mapped[bool] = mapped_column(Boolean, default=False)
    part_sociale: Mapped[float] = mapped_column(Float, default=0)
    droit_adhesion: Mapped[float] = mapped_column(Float, default=0)
    promotion: Mapped[bool] = mapped_column(Boolean, default=False)


class DemandeOuvertureCompte(Base):
    __tablename__ = "demandes_ouverture_compte"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    client_id: Mapped[str] = mapped_column(String, index=True)
    type: Mapped[str] = mapped_column(String)
    promotion: Mapped[bool] = mapped_column(Boolean, default=False)
    part_sociale: Mapped[float] = mapped_column(Float, default=0)
    droit_adhesion: Mapped[float] = mapped_column(Float, default=0)
    caissier_id: Mapped[str] = mapped_column(String, index=True)
    demandeur_id: Mapped[str] = mapped_column(String)
    demandeur_nom: Mapped[str] = mapped_column(String)
    date_demande: Mapped[str] = mapped_column(String)
    statut: Mapped[str] = mapped_column(String, default="en_attente")  # en_attente | validee | refusee
    date_traitement: Mapped[str | None] = mapped_column(String, nullable=True)
    compte_id: Mapped[str | None] = mapped_column(String, nullable=True)
    motif_refus: Mapped[str | None] = mapped_column(Text, nullable=True)


class MouvementCompte(Base):
    __tablename__ = "mouvements"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    compte_id: Mapped[str] = mapped_column(String, index=True)
    type: Mapped[str] = mapped_column(String)
    montant: Mapped[float] = mapped_column(Float)
    date: Mapped[str] = mapped_column(String)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)


class Credit(Base):
    __tablename__ = "credits"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    numero: Mapped[str] = mapped_column(String)
    client_id: Mapped[str] = mapped_column(String, index=True)
    montant: Mapped[float] = mapped_column(Float)
    taux_interet: Mapped[float] = mapped_column(Float)
    duree_mois: Mapped[int] = mapped_column(Integer)
    motif: Mapped[str | None] = mapped_column(Text, nullable=True)
    date_demande: Mapped[str] = mapped_column(String)
    date_octroi: Mapped[str | None] = mapped_column(String, nullable=True)
    statut: Mapped[str] = mapped_column(String)


class Remboursement(Base):
    __tablename__ = "remboursements"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    credit_id: Mapped[str] = mapped_column(String, index=True)
    montant: Mapped[float] = mapped_column(Float)
    date: Mapped[str] = mapped_column(String)


class Transaction(Base):
    __tablename__ = "transactions"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    type: Mapped[str] = mapped_column(String, index=True)
    client_id: Mapped[str] = mapped_column(String, index=True)
    montant: Mapped[float] = mapped_column(Float)
    date: Mapped[str] = mapped_column(String, index=True)
    description: Mapped[str] = mapped_column(Text)
    operateur: Mapped[str] = mapped_column(String)
    operateur_id: Mapped[str] = mapped_column(String, index=True)
    agence_id: Mapped[str] = mapped_column(String, index=True)
    annulee: Mapped[bool] = mapped_column(Boolean, default=False)
    motif_annulation: Mapped[str | None] = mapped_column(Text, nullable=True)
    date_annulation: Mapped[str | None] = mapped_column(String, nullable=True)
    annule_par_id: Mapped[str | None] = mapped_column(String, nullable=True)
    annule_par_nom: Mapped[str | None] = mapped_column(String, nullable=True)


class CompteCaisse(Base):
    __tablename__ = "comptes_caisse"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    employe_id: Mapped[str] = mapped_column(String, unique=True)
    agence_id: Mapped[str] = mapped_column(String)
    numero: Mapped[str] = mapped_column(String)
    solde: Mapped[float] = mapped_column(Float, default=0)
    cumul_manquant: Mapped[float] = mapped_column(Float, default=0)
    cumul_surplus: Mapped[float] = mapped_column(Float, default=0)
    date_ouverture: Mapped[str] = mapped_column(String)
    actif: Mapped[bool] = mapped_column(Boolean, default=True)


class MouvementCompteCaisse(Base):
    __tablename__ = "mouvements_compte_caisse"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    compte_caisse_id: Mapped[str] = mapped_column(String, index=True)
    employe_id: Mapped[str] = mapped_column(String)
    type: Mapped[str] = mapped_column(String)
    montant: Mapped[float] = mapped_column(Float)
    sens: Mapped[str] = mapped_column(String)
    solde_apres: Mapped[float] = mapped_column(Float)
    date: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(Text)
    transaction_id: Mapped[str | None] = mapped_column(String, nullable=True)
    operateur_id: Mapped[str] = mapped_column(String)
    operateur_nom: Mapped[str] = mapped_column(String)


class AjustementCompteCaisse(Base):
    __tablename__ = "ajustements_compte_caisse"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    compte_caisse_id: Mapped[str] = mapped_column(String)
    employe_id: Mapped[str] = mapped_column(String)
    date: Mapped[str] = mapped_column(String)
    type: Mapped[str] = mapped_column(String)
    montant: Mapped[float] = mapped_column(Float)
    motif: Mapped[str] = mapped_column(Text)
    admin_id: Mapped[str] = mapped_column(String)
    admin_nom: Mapped[str] = mapped_column(String)
    cumul_avant: Mapped[float] = mapped_column(Float)
    cumul_apres: Mapped[float] = mapped_column(Float)


class OuvertureCaisse(Base):
    __tablename__ = "ouvertures_caisse"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    employe_id: Mapped[str] = mapped_column(String, index=True)
    employe_nom: Mapped[str] = mapped_column(String)
    agence_id: Mapped[str] = mapped_column(String)
    journee: Mapped[str] = mapped_column(String, index=True)
    solde_ouverture: Mapped[float] = mapped_column(Float)
    date_ouverture: Mapped[str] = mapped_column(String)
    ouvert_par_id: Mapped[str] = mapped_column(String)
    ouvert_par_nom: Mapped[str] = mapped_column(String)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)


class ArretCaisse(Base):
    __tablename__ = "arrets_caisse"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    employe_id: Mapped[str] = mapped_column(String, index=True)
    employe_nom: Mapped[str] = mapped_column(String)
    agence_id: Mapped[str] = mapped_column(String)
    journee: Mapped[str] = mapped_column(String, index=True)
    date_cloture: Mapped[str] = mapped_column(String)
    date: Mapped[str | None] = mapped_column(String, nullable=True)
    debut_periode: Mapped[str] = mapped_column(String)
    nombre_operations: Mapped[int] = mapped_column(Integer)
    total_entrees: Mapped[float] = mapped_column(Float)
    total_sorties: Mapped[float] = mapped_column(Float)
    solde_ouverture: Mapped[float] = mapped_column(Float)
    solde_theorique: Mapped[float] = mapped_column(Float)
    montant_compte: Mapped[float] = mapped_column(Float)
    ecart: Mapped[float] = mapped_column(Float)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    valide_par_id: Mapped[str | None] = mapped_column(String, nullable=True)
    valide_par_nom: Mapped[str | None] = mapped_column(String, nullable=True)


class JournalConnexion(Base):
    __tablename__ = "journal_connexions"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    employe_id: Mapped[str] = mapped_column(String, index=True)
    employe_nom: Mapped[str] = mapped_column(String)
    agence_id: Mapped[str] = mapped_column(String)
    date: Mapped[str] = mapped_column(String)
    type: Mapped[str] = mapped_column(String)


class Compteur(Base):
    __tablename__ = "compteurs"
    cle: Mapped[str] = mapped_column(String, primary_key=True)
    valeur: Mapped[int] = mapped_column(Integer, default=0)


class CompteurOrdreZone(Base):
    __tablename__ = "compteurs_ordre_zone"
    zone_id: Mapped[str] = mapped_column(String, primary_key=True)
    valeur: Mapped[int] = mapped_column(Integer, default=0)


# ---------- Comptabilité générale (SYSCOHADA) ----------


class ExerciceComptable(Base):
    __tablename__ = "exercices_comptables"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    annee: Mapped[int] = mapped_column(Integer, unique=True, index=True)
    date_debut: Mapped[str] = mapped_column(String)
    date_fin: Mapped[str] = mapped_column(String)
    statut: Mapped[str] = mapped_column(String, default="ouvert")  # ouvert | cloture
    bilan_valide: Mapped[bool] = mapped_column(Boolean, default=False)
    date_cloture: Mapped[str | None] = mapped_column(String, nullable=True)


class CompteComptable(Base):
    __tablename__ = "comptes_comptables"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    numero: Mapped[str] = mapped_column(String, unique=True, index=True)
    intitule: Mapped[str] = mapped_column(String)
    classe: Mapped[int] = mapped_column(Integer)
    type: Mapped[str] = mapped_column(String)  # actif | passif | charge | produit | hors
    actif: Mapped[bool] = mapped_column(Boolean, default=True)


class JournalComptable(Base):
    __tablename__ = "journaux_comptables"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    code: Mapped[str] = mapped_column(String, unique=True, index=True)
    libelle: Mapped[str] = mapped_column(String)
    actif: Mapped[bool] = mapped_column(Boolean, default=True)


class EcritureComptable(Base):
    __tablename__ = "ecritures_comptables"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    exercice_id: Mapped[str] = mapped_column(String, index=True)
    journal_id: Mapped[str] = mapped_column(String, index=True)
    date: Mapped[str] = mapped_column(String, index=True)
    numero_piece: Mapped[str] = mapped_column(String)
    libelle: Mapped[str] = mapped_column(String)
    source: Mapped[str] = mapped_column(String, default="manuel")  # manuel | auto | ouverture | anouveaux
    source_type: Mapped[str | None] = mapped_column(String, nullable=True)
    source_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    auteur_id: Mapped[str | None] = mapped_column(String, nullable=True)
    auteur_nom: Mapped[str | None] = mapped_column(String, nullable=True)
    date_creation: Mapped[str] = mapped_column(String)


class LigneEcriture(Base):
    __tablename__ = "lignes_ecriture"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    ecriture_id: Mapped[str] = mapped_column(String, index=True)
    compte_id: Mapped[str] = mapped_column(String, index=True)
    compte_numero: Mapped[str] = mapped_column(String)
    libelle: Mapped[str | None] = mapped_column(String, nullable=True)
    debit: Mapped[float] = mapped_column(Float, default=0)
    credit: Mapped[float] = mapped_column(Float, default=0)


class BilanInitialLigne(Base):
    __tablename__ = "bilan_initial_lignes"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    exercice_id: Mapped[str] = mapped_column(String, index=True)
    compte_id: Mapped[str] = mapped_column(String, index=True)
    compte_numero: Mapped[str] = mapped_column(String)
    sens: Mapped[str] = mapped_column(String)  # actif | passif
    montant: Mapped[float] = mapped_column(Float, default=0)


class MappingEcriture(Base):
    __tablename__ = "mappings_ecriture"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    type_operation: Mapped[str] = mapped_column(String, unique=True, index=True)
    journal_code: Mapped[str] = mapped_column(String)
    compte_debit: Mapped[str] = mapped_column(String)
    compte_credit: Mapped[str] = mapped_column(String)
    libelle_modele: Mapped[str] = mapped_column(String)
    actif: Mapped[bool] = mapped_column(Boolean, default=True)


class SchemaMigration(Base):
    """Journal des migrations déjà appliquées. Hors AppData : ne pas vider via replace_state."""
    __tablename__ = "schema_migrations"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    applied_at: Mapped[str] = mapped_column(String)
